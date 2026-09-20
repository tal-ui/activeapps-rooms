// room-digest — daily 08:00 Asia/Jerusalem digest per client member (spec §4.9)
// and offer-expiry reminders (5 days and 1 day before).
//
// pg_cron calls this at 05:00 and 06:00 UTC; we only run when it is 08:00 in
// Asia/Jerusalem (or when the body carries {"force": true} for manual tests).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendMail } from "../_shared/email.ts";
import { str, esc, type Lang } from "../_shared/strings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function jerusalemHour(): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(new Date()));
}
function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    if (!body.force && jerusalemHour() !== 8) return json({ ok: true, skipped: `local hour ${jerusalemHour()}` });

    const { data: appRow } = await admin.from("room_settings").select("value").eq("key", "app_url").maybeSingle();
    const base = ((appRow?.value as string) || "https://rooms.activeapps.io").replace(/\/$/, "");

    const { data: rooms } = await admin.from("rooms").select("id, slug, name, client_name, language").is("deleted_at", null).neq("phase", "closed");
    const out: Record<string, unknown> = {};

    for (const room of rooms ?? []) {
      const lang = (room.language === "he" ? "he" : "en") as Lang;
      const s = str(lang);
      const roomUrl = `${base}/r/${room.slug}`;
      const [{ data: members }, { data: engagements }, { data: docs }] = await Promise.all([
        admin.from("room_members").select("id, email, full_name, side, role, status, last_seen_at, notification_prefs, expires_at").eq("room_id", room.id).eq("side", "client").eq("status", "active"),
        admin.from("room_engagements").select("id, name, status, offer_valid_until").eq("room_id", room.id).eq("status", "shared"),
        admin.from("room_documents").select("id, title, confidential, status").eq("room_id", room.id).eq("status", "published"),
      ]);
      const docIds = (docs ?? []).map((d) => d.id);
      const [{ data: pendingBlocks }, { data: openQuestions }, { data: openComments }] = await Promise.all([
        docIds.length ? admin.from("room_blocks").select("id, document_id, type, content").in("document_id", docIds).in("status", ["in_review", "changed"]).is("deleted_at", null).in("type", ["deliverable", "assumption", "milestone", "pricing_line", "table"]) : Promise.resolve({ data: [] }),
        admin.from("room_questions").select("id, title, due_date, owner_member_id, document_id, block_id").eq("room_id", room.id).eq("status", "open"),
        admin.from("room_comments").select("id, mentions, created_at, document_id, block_id, body").eq("room_id", room.id).eq("internal_only", false).is("resolved_at", null).is("deleted_at", null),
      ]);

      for (const m of members ?? []) {
        if (m.expires_at && new Date(m.expires_at) <= new Date()) continue;
        const prefs = (m.notification_prefs ?? {}) as Record<string, string>;
        if (prefs.digest === "off") continue;
        const canApprove = m.role === "owner" || m.role === "approver";
        const myBlocks = canApprove ? (pendingBlocks ?? []) : [];
        const myQuestions = (openQuestions ?? []).filter((q) => q.owner_member_id === m.id);
        const since = m.last_seen_at ? new Date(m.last_seen_at).getTime() : 0;
        const myMentions = (openComments ?? []).filter((c) => (c.mentions as string[]).includes(m.id) && new Date(c.created_at).getTime() > since);

        const items: string[] = [];
        if (myBlocks.length) items.push(`<li><strong>${s.pending_blocks(myBlocks.length)}</strong><ul>${myBlocks.slice(0, 6).map((b) => { const c = b.content as Record<string, string>; return `<li><a href="${roomUrl}/doc/${b.document_id}?block=${b.id}" style="color:#3CC998">${esc(c.title || c.text || c.label || b.type)}</a></li>`; }).join("")}</ul></li>`);
        if (myQuestions.length) items.push(`<li><strong>${s.owned_questions(myQuestions.length)}</strong><ul>${myQuestions.slice(0, 6).map((q) => `<li><a href="${roomUrl}/questions?q=${q.id}" style="color:#3CC998">${esc(q.title)}</a>${q.due_date ? ` <span style="color:#79818D">(${s.due} ${esc(q.due_date)})</span>` : ""}</li>`).join("")}</ul></li>`);
        if (myMentions.length) items.push(`<li><strong>${s.mentions(myMentions.length)}</strong><ul>${myMentions.slice(0, 4).map((c) => `<li><a href="${roomUrl}/doc/${c.document_id}?block=${c.block_id ?? ""}" style="color:#3CC998">${esc(String(c.body).slice(0, 120))}</a></li>`).join("")}</ul></li>`);

        // offer expiry (5 days and 1 day before) — everyone on the client side
        for (const e of engagements ?? []) {
          if (!e.offer_valid_until) continue;
          const d = daysUntil(e.offer_valid_until);
          if (d === 5 || d === 1) {
            const res = await sendMail({ to: m.email, subject: s.expiry_subject(d, e.name), heading: s.expiry_heading(d), bodyHtml: `<p><strong>${esc(e.name)}</strong> · ${esc(e.offer_valid_until)}</p>`, ctaLabel: s.open, ctaUrl: roomUrl, lang, footer: s.footer });
            await admin.from("room_notifications").insert({ room_id: room.id, member_id: m.id, channel: "email", status: res.ok ? "sent" : "failed", sent_at: res.ok ? new Date().toISOString() : null, payload: { kind: "offer_expiry", days: d, engagement_id: e.id, error: res.error ?? null, skipped: res.skipped ?? false } });
            await admin.from("room_notifications").insert({ room_id: room.id, member_id: m.id, channel: "in_app", status: "pending", payload: { kind: "offer_expiry", title: s.expiry_heading(d), url: roomUrl } });
          }
        }

        if (!items.length) continue;
        const res = await sendMail({ to: m.email, subject: s.digest_subject(room.name), heading: s.digest_heading(room.name), bodyHtml: `<ul style="padding-inline-start:18px;">${items.join("")}</ul>`, ctaLabel: s.open, ctaUrl: roomUrl, lang, footer: s.footer });
        await admin.from("room_notifications").insert({ room_id: room.id, member_id: m.id, channel: "email", status: res.ok ? "sent" : "failed", sent_at: res.ok ? new Date().toISOString() : null, payload: { kind: "digest", blocks: myBlocks.length, questions: myQuestions.length, mentions: myMentions.length, error: res.error ?? null, skipped: res.skipped ?? false } });
        out[`${room.slug}:${m.email}`] = res.ok ? "sent" : res.error;
      }
    }
    return json({ ok: true, out });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
