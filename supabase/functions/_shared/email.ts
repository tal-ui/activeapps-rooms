// Minimal Resend client + bilingual branded layout (spec §4.9: every e-mail
// carries the content itself, one clear action button, reply-to Tal).
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("ROOMS_EMAIL_FROM") ?? "ActiveApps <notifications@activeapps.io>";
const REPLY_TO = Deno.env.get("ROOMS_EMAIL_REPLY_TO") ?? "tal@activeapps.io";

export interface Mail {
  to: string;
  subject: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  lang: "he" | "en";
  footer?: string;
}

export function layout(m: Mail): string {
  const dir = m.lang === "he" ? "rtl" : "ltr";
  const font = m.lang === "he" ? "Heebo, Arial, sans-serif" : "Inter, Arial, sans-serif";
  return `<!doctype html><html lang="${m.lang}" dir="${dir}"><body style="margin:0;background:#06090F;color:#E3E5E8;font-family:${font};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#06090F;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#151B24;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
        <tr><td style="padding:24px 28px 0;font-family:'Space Grotesk',Arial,sans-serif;font-weight:700;font-size:15px;letter-spacing:-0.01em;" dir="ltr">
          <span style="color:#BABEC4">ACTIVE</span><span style="color:#3CC998">APPS</span>
          <span style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.15em;color:#5E6268;text-transform:uppercase;margin-top:2px;">Tech Orchestration</span>
        </td></tr>
        <tr><td style="padding:20px 28px 0;"><h1 style="margin:0;font-size:20px;line-height:1.3;color:#E3E5E8;">${m.heading}</h1></td></tr>
        <tr><td style="padding:14px 28px 0;font-size:15px;line-height:1.65;color:#BABEC4;">${m.bodyHtml}</td></tr>
        <tr><td style="padding:24px 28px 28px;">
          <a href="${m.ctaUrl}" style="display:inline-block;background:#3CC998;color:#06090F;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;">${m.ctaLabel}</a>
        </td></tr>
        <tr><td style="padding:0 28px 24px;font-size:12px;color:#6E7278;line-height:1.5;">${m.footer ?? ""}</td></tr>
      </table>
      <p style="font-size:11px;color:#3F4348;margin:16px 0 0;">ActiveApps · rooms.activeapps.io</p>
    </td></tr>
  </table></body></html>`;
}

export async function sendMail(m: Mail): Promise<{ ok: boolean; id?: string; error?: string; skipped?: boolean }> {
  if (!RESEND_API_KEY) return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [m.to], reply_to: REPLY_TO, subject: m.subject, html: layout(m) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (data as { message?: string }).message ?? `resend ${res.status}` };
  return { ok: true, id: (data as { id?: string }).id };
}
