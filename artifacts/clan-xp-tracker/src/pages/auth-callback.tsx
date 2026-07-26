import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

/**
 * Post-OAuth landing page. Discord bounced the browser back to the server's
 * /api/auth/callback, which set the session and redirected here. Rather than
 * waiting a fixed delay and hoping the session is readable, we poll
 * /api/auth/me until it succeeds, then move on to the server picker. This makes
 * login resilient to any residual write/read timing on the session store.
 */
export default function AuthCallbackPage() {
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function waitForSession() {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (cancelled) return;
        try {
          await customFetch("/api/auth/me");
          if (!cancelled) navigate("/guilds");
          return;
        } catch {
          // Not authenticated yet — back off briefly and retry.
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (!cancelled) setFailed(true);
    }

    void waitForSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        {failed ? (
          <>
            <p className="text-muted-foreground mb-4">
              We couldn't finish signing you in.
            </p>
            <a href="/" className="text-primary underline">
              Return home and try again
            </a>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Logging you in…</p>
          </>
        )}
      </div>
    </div>
  );
}
