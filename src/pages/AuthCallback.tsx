import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { translate } from "../lib/i18n";
import { Wordmark, Spinner, ErrorBox } from "../components/ui";

/**
 * Handles both link styles:
 *  - our own invitation e-mails carry ?token_hash=…&type=magiclink (works on any
 *    device, no PKCE verifier needed)
 *  - Supabase's default magic-link template redirects here with tokens in the
 *    URL hash, which supabase-js picks up automatically (implicit flow).
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const lang = (navigator.language || "").startsWith("he") ? "he" : "en";
  const t = (k: Parameters<typeof translate>[1]) => translate(lang, k);
  const next = params.get("next") || "/";
  const email = params.get("email") || "";

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigate(next, { replace: true });
    };
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as "magiclink" | "invite" | "email" | "recovery" | null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) finish();
    });
    (async () => {
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type === "invite" ? "invite" : type === "recovery" ? "recovery" : type === "email" ? "email" : "magiclink" });
        if (error) {
          setFailed(true);
          return;
        }
        finish();
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) finish();
      else {
        // implicit-flow hash may still be processing; give it a moment
        window.setTimeout(async () => {
          const again = await supabase.auth.getSession();
          if (again.data.session) finish();
          else setFailed(true);
        }, 2500);
      }
    })();
    return () => sub.subscription.unsubscribe();
  }, [params, navigate, next]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Wordmark size="lg" />
      {failed ? (
        <>
          <ErrorBox message={t("auth_failed")} />
          <a className="btn btn-primary" href={`/login?next=${encodeURIComponent(next)}${email ? `&email=${encodeURIComponent(email)}` : ""}`}>{t("login_send_link")}</a>
        </>
      ) : (
        <>
          <Spinner size={26} />
          <p className="text-text-mid">{t("auth_verifying")}</p>
        </>
      )}
    </div>
  );
}
