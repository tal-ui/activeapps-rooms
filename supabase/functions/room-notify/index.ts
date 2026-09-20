// room-notify — turns a room_events row into e-mails (Resend), Slack posts and
// in-app notifications, honouring each member's notification_prefs.
//
// Triggered by the room_events_notify trigger (pg_net) with
//   { type: "INSERT", table: "room_events", record: {...} }
//
// Rules (spec §4.9):
//   client e-mail (immediate): @mention · question assigned · answer to own
//     question · new version (with change summary) · approved block changed
//   ActiveApps Slack: first client view of the day · client comment/question ·
//     block approved · SOW approved · pricing chosen · colleague invited ·
//     NDA accepted · expired-access request · engagement signed
//   in-app: every client recipient above, plus staff for client actions
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendMail } from "../_shared/email.ts";
import { getSlackConfig, postSlack, blocksFor } from "../_shared/slack.ts";
import { str, esc, type Lang } from "../_shared/strings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface EventRow {
  id: string; room_id: string; actor_member_id: string | null; type: string; entity_type: string | null;
  entity_id: string | null; payload: Record<string, unknown>; client_visible: boolean; created_at: string;
}
interface Member {
  id: string; room_id: string; email: string; full_name: string; side: "activeapps" | "client"; role: string;
  status: string; last_seen_at: string | null; notification_prefs: Record<string, "immediate" | "digest" | "off"> | null;
}
interface Room { id: string; slug: string; name: string; client_name: string; language: Lang }

type Pref = "immediate" | "digest" | "off";
const PREF_DEFAULT: Pref = "immediate";
function pref(m: Member, kind: string): Pref {
  return (m.notification_prefs?.[kind] as Pref | undefined) ?? (m.notification_prefs?.all as Pref | undefined) ?? PREF_DEFAULT;
}

async function appUrl(): Promise<string> {
  const { data } = await admin.from("room_settings").select("value").eq("key", "app_url").maybeSingle();
  return ((data?.value as string) || Deno.env.get("ROOMS_APP_URL") || "https://rooms.activeapps.io").replace(/\/$/, "");
}
async function slackKey(): Promise<string> {
  const { data } = await admin.from("room_settings").select("value").eq("key", "slack_channel_key").maybeSingle();
  return (data?.value as string) || "rooms";
}

async function record(roomId: string, memberId: string, eventId: string, channel: "email" | "slack" | "in_app", status: "sent" | "failed" | "pending", payload: Record<string, unknown>) {
  await admin.from("room_notifications").insert({ room_id: roomId, member_id: memberId, event_id: eventId, channel, status, sent_at: status === "sent" ? new Date().toISOString() : null, payload });
}

async function emailMember(room: Room, m: Member, ev: EventRow, kind: string, subject: string, heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  const p = pref(m, kind);
  // in-app always (cheap, drives the bell); e-mail only when immediate
  await record(room.id, m.id, ev.id, "in_app", "pending", { kind, title: heading, url: ctaUrl });
  if (p !== "immediate") return { skipped: p };
  const res = await sendMail({ to: m.email, subject, heading, bodyHtml, ctaLabel, ctaUrl, lang: room.language, footer: str(room.language).footer });
  await record(room.id, m.id, ev.id, "email", res.ok ? "sent" : "failed", { kind, subject, provider_id: res.id ?? null, error: res.error ?? null, skipped: res.skipped ?? false });
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = (await req.json()) as { type: string; table?: string; record?: EventRow };
    const ev = payload.record;
    if (!ev || payload.table !== "room_events") return json({ ok: false, reason: "not_an_event" });
    if (ev.type === "document_viewed" || ev.type === "block_viewed") return json({ ok: true, skipped: ev.type });

    const [{ data: roomRow }, { data: memberRows }] = await Promise.all([
      admin.from("rooms").select("id, slug, name, client_name, language").eq("id", ev.room_id).single(),
      admin.from("room_members").select("id, room_id, email, full_name, side, role, status, last_seen_at, notification_prefs").eq("room_id", ev.room_id).neq("status", "revoked"),
    ]);
    if (!roomRow) return json({ ok: false, reason: "room_not_found" });
    const room = roomRow as Room;
    const members = (memberRows ?? []) as Member[];
    const actor = members.find((m) => m.id === ev.actor_member_id) ?? null;
    const actorName = actor?.full_name || "ActiveApps";
    const clients = members.filter((m) => m.side === "client" && m.status !== "revoked");
    const staff = members.filter((m) => m.side === "activeapps");
    const base = await appUrl();
    const roomUrl = `${base}/r/${room.slug}`;
    const s = str(room.language);
    const p = ev.payload as Record<string, string | number | string[] | null | undefined>;
    const results: Record<string, unknown> = {};

    // ---------------- client e-mails ----------------
    switch (ev.type) {
      case "comment_added": {
        const mentions = (p.mentions as string[] | undefined) ?? [];
        const targets = clients.filter((m) => mentions.includes(m.id) && m.id !== ev.actor_member_id);
        const url = p.document_id ? `${roomUrl}/doc/${p.document_id}${p.block_id ? `?block=${p.block_id}` : ""}` : `${roomUrl}/activity`;
        for (const m of targets) {
          results[`mention:${m.email}`] = await emailMember(room, m, ev, "mention",
            s.mention_subject(actorName, room.name), s.mention_heading(actorName),
            `<blockquote style="border-inline-start:2px solid #3CC998;margin:0 0 12px;padding:4px 14px;color:#E3E5E8;">${esc(p.excerpt)}</blockquote>`,
            s.open, url);
        }
        break;
      }
      case "question_asked": {
        const owner = clients.find((m) => m.id === p.owner_member_id && m.id !== ev.actor_member_id);
        if (owner) {
          const url = p.document_id ? `${roomUrl}/doc/${p.document_id}${p.block_id ? `?block=${p.block_id}` : ""}` : `${roomUrl}/questions?q=${ev.entity_id}`;
          results[`question:${owner.email}`] = await emailMember(room, owner, ev, "question_assigned",
            s.question_subject(actorName, String(p.title)), s.question_heading(actorName),
            `<p><strong>${esc(p.title)}</strong></p>${p.due_date ? `<p style="color:#79818D;font-size:13px;">${s.due}: ${esc(p.due_date)}</p>` : ""}`,
            s.open_question, `${roomUrl}/questions?q=${ev.entity_id}`.replace(/\?q=null$/, "") || url);
        }
        break;
      }
      case "question_answered": {
        const asker = clients.find((m) => m.id === p.asked_by_member_id && m.id !== ev.actor_member_id);
        if (asker) {
          results[`answer:${asker.email}`] = await emailMember(room, asker, ev, "question_answered",
            s.answer_subject(String(p.title)), s.answer_heading(actorName),
            `<p><strong>${esc(p.title)}</strong></p><p>${esc(p.answer)}</p>`,
            s.open, `${roomUrl}/questions`);
        }
        break;
      }
      case "version_published": {
        const docId = String(ev.entity_id);
        const url = `${roomUrl}/doc/${docId}`;
        const summary = `<p>${esc(p.change_summary)}</p><p style="color:#79818D;font-size:13px;">+${p.added ?? 0} · ~${p.changed ?? 0} · −${p.removed ?? 0}</p>`;
        for (const m of clients) {
          results[`version:${m.email}`] = await emailMember(room, m, ev, "version_published",
            s.version_subject(String(p.title), Number(p.version)), s.version_heading(String(p.title), Number(p.version)), summary, s.open_doc, url);
        }
        // approved-then-changed blocks → their approvers
        const { data: changed } = await admin.from("room_blocks").select("id, type, content, approved_by_member_id").eq("document_id", docId).eq("status", "changed").is("deleted_at", null);
        for (const b of changed ?? []) {
          const approver = clients.find((m) => m.id === b.approved_by_member_id);
          if (!approver) continue;
          const c = b.content as Record<string, string>;
          const title = c.title || c.text || c.label || c.name || b.type;
          results[`changed:${approver.email}:${b.id}`] = await emailMember(room, approver, ev, "approved_block_changed",
            s.changed_subject(title), s.changed_heading(), `<p><strong>${esc(title)}</strong></p>`, s.open_doc, `${url}?block=${b.id}`);
        }
        break;
      }
      case "sow_approved": {
        // confirmation to every client member (content: what was approved)
        for (const m of clients) {
          results[`sow:${m.email}`] = await emailMember(room, m, ev, "sow_approved",
            s.sow_subject(String(p.engagement_name)), s.sow_heading(String(p.engagement_name)),
            `<p>${esc(p.by)} · v${esc(p.version)}</p>`, s.open, `${roomUrl}/doc/${p.document_id}`);
        }
        break;
      }
      default:
        break;
    }

    // ---------------- Slack to ActiveApps ----------------
    const clientAction = actor?.side === "client";
    let slackKind: string | null = null;
    let header = "";
    const fields: [string, string][] = [["Room", room.name], ["By", actorName]];
    if (ev.type === "room_viewed" && clientAction) {
      // first view of the day for this member?
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const { count } = await admin.from("room_events").select("id", { count: "exact", head: true }).eq("room_id", room.id).eq("actor_member_id", ev.actor_member_id!).eq("type", "room_viewed").gte("created_at", dayStart.toISOString()).neq("id", ev.id);
      if ((count ?? 0) === 0) { slackKind = "first_view"; header = "👀 Client opened the room"; }
    } else if (ev.type === "comment_added" && clientAction && !p.internal_only) { slackKind = "comment"; header = "💬 Client comment"; fields.push(["Comment", String(p.excerpt ?? "")]); }
    else if (ev.type === "question_asked" && clientAction) { slackKind = "question"; header = "❓ Client question"; fields.push(["Question", String(p.title ?? "")]); }
    else if (ev.type === "block_approved") { slackKind = "approval"; header = "✅ Block approved"; fields.push(["Block", String(p.title ?? p.block_type ?? "")]); }
    else if (ev.type === "sow_approved") { slackKind = "sow"; header = "🏁 SOW approved"; fields.push(["Engagement", String(p.engagement_name ?? "")], ["Version", `v${p.version ?? ""}`]); }
    else if (ev.type === "pricing_option_selected") { slackKind = "pricing"; header = "💰 Pricing option chosen"; fields.push(["Option", String(p.option_name ?? "")]); }
    else if (ev.type === "member_invited" && clientAction) { slackKind = "invite"; header = "➕ Client invited a colleague"; fields.push(["Invitee", `${p.full_name ?? ""} <${p.email ?? ""}>`], ["Role", String(p.role ?? "")]); }
    else if (ev.type === "nda_accepted") { slackKind = "nda"; header = "🔏 NDA accepted"; }
    else if (ev.type === "access_expired_requested") { slackKind = "access"; header = "⏳ Expired access — renewal requested"; }
    else if (ev.type === "engagement_signed") { slackKind = "signed"; header = "🏆 Engagement signed"; fields.push(["Engagement", String(p.engagement_name ?? "")], ["CRM stage", String(p.stage ?? "")]); }

    if (slackKind) {
      const cfg = await getSlackConfig(admin);
      if (cfg) {
        const key = await slackKey();
        const res = await postSlack(cfg, key, `${header} — ${room.name}`, blocksFor(header, fields, roomUrl));
        results.slack = res;
        for (const m of staff) await record(room.id, m.id, ev.id, "slack", res.ok ? "sent" : "failed", { kind: slackKind, error: res.error ?? null });
      } else {
        results.slack = { ok: false, error: "slack_not_configured" };
      }
      // in-app for staff on client actions
      for (const m of staff) await record(room.id, m.id, ev.id, "in_app", "pending", { kind: slackKind, title: header, url: roomUrl });
    }

    return json({ ok: true, results });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
