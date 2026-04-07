import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    console.log("[SignalCollector] Starting signal collection run");

    // Get all published content with external_post_id (real X posts)
    const { data: publishedContent, error: contentError } = await supabase
      .from("content")
      .select("id, external_post_id, platform, user_id")
      .eq("status", "published")
      .not("external_post_id", "is", null);

    if (contentError) throw contentError;

    if (!publishedContent || publishedContent.length === 0) {
      console.log("[SignalCollector] No published posts with external IDs to collect signals for");
      return new Response(JSON.stringify({ collected: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[SignalCollector] Found ${publishedContent.length} published posts`);

    let collected = 0;
    let errors = 0;

    // Group by user to batch token lookups
    const byUser = new Map<string, typeof publishedContent>();
    for (const item of publishedContent) {
      const list = byUser.get(item.user_id) || [];
      list.push(item);
      byUser.set(item.user_id, list);
    }

    for (const [userId, items] of byUser) {
      // Get user's X connection (if they have X posts)
      const xItems = items.filter(i => i.platform === "x");
      const liItems = items.filter(i => i.platform === "linkedin");

      // ── X signal collection ──
      const { data: xConnection } = await supabase
        .from("platform_connections")
        .select("access_token, refresh_token, expires_at")
        .eq("user_id", userId)
        .eq("platform", "x")
        .eq("connected", true)
        .maybeSingle();

      if (xItems.length > 0) {
        if (!xConnection?.access_token) {
          console.log(`[SignalCollector] No X connection for user ${userId}, skipping X posts`);
        } else {
          let accessToken = xConnection.access_token;

          if (xConnection.expires_at && new Date(xConnection.expires_at) <= new Date()) {
            try {
              const refreshed = await refreshXToken(xConnection.refresh_token!, supabase, userId);
              if (refreshed) accessToken = refreshed;
              else { console.error(`[SignalCollector] X token refresh failed for user ${userId}`); accessToken = ""; }
            } catch (err) {
              console.error(`[SignalCollector] X token refresh error for user ${userId}:`, err);
              accessToken = "";
            }
          }

          if (accessToken) {
            for (const item of xItems) {
              try {
                const tweetId = item.external_post_id;
                const response = await fetch(
                  `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
                  { headers: { Authorization: `Bearer ${accessToken}` } }
                );

                if (!response.ok) {
                  console.error(`[SignalCollector] X API error for tweet ${tweetId}: ${response.status}`);
                  await response.text();
                  errors++;
                  continue;
                }

                const data = await response.json();
                const metrics = data.data?.public_metrics;

                if (metrics) {
                  const { error: upsertError } = await supabase
                    .from("performance_signals")
                    .insert({
                      content_id: item.id,
                      platform: "x",
                      impressions: metrics.impression_count || 0,
                      likes: metrics.like_count || 0,
                      comments: metrics.reply_count || 0,
                      reposts: metrics.retweet_count + (metrics.quote_count || 0),
                      clicks: 0,
                      conversions: 0,
                    });

                  if (upsertError) {
                    console.error(`[SignalCollector] Insert error for ${item.id}:`, upsertError);
                    errors++;
                  } else {
                    collected++;
                    await supabase.from("content").update({
                      impressions: metrics.impression_count || 0,
                      engagements: (metrics.like_count || 0) + (metrics.reply_count || 0) + (metrics.retweet_count || 0),
                      clicks: 0,
                    }).eq("id", item.id);
                  }
                }
              } catch (err) {
                console.error(`[SignalCollector] Error collecting for ${item.id}:`, err);
                errors++;
              }
            }
          }
        }
      }

      // ── LinkedIn signal collection ──
      // LinkedIn Share Statistics API: GET /organizationalEntityShareStatistics or /shares/{id}
      // For personal shares with w_member_social, we can try the share statistics endpoint
      if (liItems.length > 0) {
        const { data: liConnection } = await supabase
          .from("platform_connections")
          .select("access_token, expires_at, account_id")
          .eq("user_id", userId)
          .eq("platform", "linkedin")
          .eq("connected", true)
          .maybeSingle();

        if (!liConnection?.access_token) {
          console.log(`[SignalCollector] No LinkedIn connection for user ${userId}, skipping`);
        } else if (liConnection.expires_at && new Date(liConnection.expires_at) <= new Date()) {
          console.log(`[SignalCollector] LinkedIn token expired for user ${userId}, skipping`);
        } else {
          for (const item of liItems) {
            try {
              // Try to get share statistics via the UGC post ID
              const shareUrn = item.external_post_id;
              if (!shareUrn) continue;

              const statsUrl = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/likes?count=0`;
              const likesResponse = await fetch(statsUrl, {
                headers: { Authorization: `Bearer ${liConnection.access_token}` },
              });

              // Also try comments count
              const commentsUrl = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/comments?count=0`;
              const commentsResponse = await fetch(commentsUrl, {
                headers: { Authorization: `Bearer ${liConnection.access_token}` },
              });

              let likes = 0;
              let comments = 0;

              if (likesResponse.ok) {
                const likesData = await likesResponse.json();
                likes = likesData.paging?.total || 0;
              } else {
                await likesResponse.text();
              }

              if (commentsResponse.ok) {
                const commentsData = await commentsResponse.json();
                comments = commentsData.paging?.total || 0;
              } else {
                await commentsResponse.text();
              }

              const engagements = likes + comments;

              const { error: insertError } = await supabase
                .from("performance_signals")
                .insert({
                  content_id: item.id,
                  platform: "linkedin",
                  impressions: 0,
                  likes,
                  comments,
                  reposts: 0,
                  clicks: 0,
                  conversions: 0,
                });

              if (insertError) {
                console.error(`[SignalCollector] LinkedIn insert error for ${item.id}:`, insertError);
                errors++;
              } else {
                collected++;
                await supabase.from("content").update({
                  engagements,
                }).eq("id", item.id);
              }
            } catch (err) {
              console.error(`[SignalCollector] LinkedIn error for ${item.id}:`, err);
              errors++;
            }
          }
        }
      }
    }

    console.log(`[SignalCollector] Done. Collected: ${collected}, Errors: ${errors}`);

    return new Response(
      JSON.stringify({ collected, errors, total: publishedContent.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[SignalCollector] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function refreshXToken(
  refreshToken: string,
  supabase: any,
  userId: string
): Promise<string | null> {
  const clientId = Deno.env.get("X_CLIENT_ID")!;
  const clientSecret = Deno.env.get("X_CLIENT_SECRET")!;

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();

  await supabase
    .from("platform_connections")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", "x");

  return data.access_token;
}
