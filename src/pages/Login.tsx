import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Mail, KeyRound, ArrowRight } from "lucide-react";
import { supabase, APP_URL } from "../lib/supabase";
import { translate, applyDocumentLanguage } from "../lib/i18n";
import type { Language } from "../lib/types";
import { Wordmark, Tagline, ErrorBox } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useEffect } from "react";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, ready } = useAuth();
  const initialLang: Language = params.get("lang") === "he" || (!params.get("lang") && (navigator.language || "").startsWith("he")) ? "he" : "en";
  const [lang, setLang] = useState<Language>(initialLang);
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, k, vars);
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get("next") ?? "/";

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  useEffect(() => {
    if (ready && session) navigate(next, { replace: true });
  }, [ready, session, navigate, next]);

  const sendMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError(t("login_error_email"));
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: false,
      },
    });
    setBusy(false);
    if (err) {
      const msg = err.message.toLowerCase();
      setError(msg.includes("signups not allowed") || msg.includes("not found") ? t("login_error_not_invited") : err.message);
      return;
    }
    setSent(true);
  };

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    navigate(next, { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-8">
            <div className="flex flex-col gap-0.5">
              <Wordmark size="lg" />
              <Tagline />
            </div>
            <button className="btn btn-ghost btn-sm font-mono" onClick={() => setLang(lang === "he" ? "en" : "he")} aria-label="language">
              {lang === "he" ? "EN" : "עב"}
            </button>
          </div>

          <div className="panel-elevated p-6 sm:p-8 glow-mint">
            {sent ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-mint/15 text-mint"><Mail size={20} /></span>
                  <h1 className="text-xl font-semibold">{t("login_sent_title")}</h1>
                </div>
                <p className="text-text-mid text-sm leading-relaxed">{t("login_sent_body", { email })}</p>
                <button className="btn btn-secondary" onClick={() => setSent(false)}>{t("login_resend")}</button>
              </div>
            ) : mode === "magic" ? (
              <form onSubmit={sendMagicLink} className="flex flex-col gap-4">
                <div>
                  <h1 className="text-xl font-semibold mb-1">{t("login_title")}</h1>
                  <p className="text-text-mid text-sm leading-relaxed">{t("login_subtitle")}</p>
                </div>
                <label className="block">
                  <span className="label-mono block mb-1.5">{t("login_email")}</span>
                  <input className="input" type="email" inputMode="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" dir="ltr" />
                </label>
                {error && <ErrorBox message={error} />}
                <button className="btn btn-primary w-full" type="submit" disabled={busy}>
                  {busy ? t("login_sending") : t("login_send_link")}
                  {!busy && <ArrowRight size={16} className="rtl:rotate-180" />}
                </button>
                <button type="button" className="btn btn-ghost btn-sm text-text-dim" onClick={() => { setMode("password"); setError(null); }}>
                  <KeyRound size={14} /> {t("login_internal")}
                </button>
              </form>
            ) : (
              <form onSubmit={signInWithPassword} className="flex flex-col gap-4">
                <div>
                  <h1 className="text-xl font-semibold mb-1">{t("login_internal")}</h1>
                </div>
                <label className="block">
                  <span className="label-mono block mb-1.5">{t("login_email")}</span>
                  <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
                </label>
                <label className="block">
                  <span className="label-mono block mb-1.5">{t("login_password")}</span>
                  <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
                </label>
                {error && <ErrorBox message={error} />}
                <button className="btn btn-primary w-full" type="submit" disabled={busy}>{t("login_with_password")}</button>
                <button type="button" className="btn btn-ghost btn-sm text-text-dim" onClick={() => { setMode("magic"); setError(null); }}>
                  <Mail size={14} /> {t("login_send_link")}
                </button>
              </form>
            )}
          </div>
          <p className="mt-6 text-center text-xs text-text-faint flex items-center justify-center gap-2">
            <span className="pulse-dot" /> {t("sla_note")}
          </p>
        </div>
      </div>
    </div>
  );
}
