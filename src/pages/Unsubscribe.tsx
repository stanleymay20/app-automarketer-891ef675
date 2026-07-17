import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("error"); setErr("Missing token"); return; }
    (async () => {
      const { data, error } = await supabase.rpc("unsubscribe_by_token", { _token: token, _reason: null });
      if (error) { setState("error"); setErr(error.message); return; }
      const res = data as { ok?: boolean; email?: string; error?: string };
      if (res?.ok) { setState("success"); setEmail(res.email ?? null); }
      else { setState("error"); setErr(res?.error ?? "unknown"); }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "loading" && <><Loader2 className="h-5 w-5 animate-spin" /> Processing…</>}
            {state === "success" && <><CheckCircle2 className="h-5 w-5 text-green-600" /> You've been unsubscribed</>}
            {state === "error" && <><XCircle className="h-5 w-5 text-destructive" /> Something went wrong</>}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          {state === "success" && (
            <>
              <p>{email ?? "Your email"} will no longer receive marketing emails from us.</p>
              <p>Any active sequences have been stopped. You can close this page.</p>
            </>
          )}
          {state === "error" && (
            <>
              <p>We couldn't process that unsubscribe link.</p>
              <p className="text-xs">Reason: {err}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
