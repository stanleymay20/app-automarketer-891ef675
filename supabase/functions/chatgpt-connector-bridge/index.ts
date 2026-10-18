import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { Store } from "../_shared/chatgpt-connector/store.mjs";
import { createBridgeHandler } from "../_shared/chatgpt-connector/bridge.mjs";

// Privileged credentials stay inside the managed backend runtime.
const secret = Deno.env.get("CONNECTOR_BRIDGE_SECRET");
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!secret || !url || !key) {
  Deno.serve(() =>
    Response.json({ error: "bridge_unavailable" }, { status: 503 })
  );
} else {
  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  Deno.serve(createBridgeHandler(new Store(db), secret));
}
