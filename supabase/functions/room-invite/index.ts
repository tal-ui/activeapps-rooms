// room-invite — sends a branded invitation with a direct sign-in link.
//
// Called by the app (supabase.functions.invoke) right after room_invite_member().
// The caller's JWT is verified; we additionally check the caller is either
// internal staff or a client owner of the same room (same rule as the RPC).
//
// Link strategy: auth.admin.generateLink({type:'magiclink'}) gives us a
// token_hash we embed as  /auth/callback?token_hash=…&type=magiclink&next=/r/<slug>
// — the app verifies it with verifyOtp, which works on any device/browser
// (no PKCE verifier needed). When RESEND_API_KEY is missing we fall back to
// Supabase's built-in invite e-mail so invitations still go out.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendMail } from "../_shared/email.ts";
import { esc } from "../_shared/strings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = (Deno.env.get("ROOMS_APP_URL") ?? "https://rooms.activeapps.io").replace(/\/$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const STR = {
  he: {
    subject: (inviter: string, client: string) => `${inviter} הזמין/ה אותך לחדר של ${client}`,
    heading: (client: string) => `החדר של ${client} ב-ActiveApps`,
    body: (inviter: string, room: string, msg: string | null) =>
      `<p>${esc(inviter)} פתח/ה עבורך חדר עבודה משותף: <strong>${esc(room)}</strong>.</p><p>בחדר תמצאו את הצעת העבודה, שאלות פתוחות והחלטות — הכול במקום אחד, בלי סיסמה.</p>${msg ? `<blockquote style="border-inline-start:2px solid #3CC998;margin:16px 0;padding:4px 14px;color:#E3E5E8;">${esc(msg)}</blockquote>` : ""}`,
    cta: "כניסה לחדר",
    footer: "הלינק אישי וחד-פעמי. אפשר תמיד לבקש לינק חדש בכתובת rooms.activeapps.io. אנחנו עונים תוך יום עסקים.",
  },
  en: {
    subject: (inviter: string, client: string) => `${inviter} invited you to the ${client} room`,
    heading: (client: string) => `Your ${client} room at ActiveApps`,
    body: (inviter: string, room: string, msg: string | null) =>
      `<p>${esc(inviter)} opened a shared workroom for you: <strong>${esc(room)}</strong>.</p><p>Inside you'll find the proposal, open questions and decisions — one place, no password.</p>${msg ? `<blockquote style="border-inline-start:2px solid #3CC998;margin:16px 0;padding:4px 14px;color:#E3E5E8;">${esc(msg)}</blockquote>` : ""}`,
    cta: "Open the room",
    footer: "This link is personal and single-use. You can always request a new one at rooms.activeapps.io. We reply within one business day.",
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) return json({ ok: false, error: "unauthorized" }, 401);

    const { member_id } = (await req.json()) as { member_id?: string };
    if (!member_id) return json({ ok: false, error: "member_id required" }, 400);

    const { data: member } = await admin.from("room_members").select("*").eq("id", member_id).maybeSingle();
    // permission first: internal writer, or client owner of the same room. Unknown ids get the same answer as forbidden ones.
    const { data: isInternal } = await caller.rpc("is_internal_writer");
    const { data: role } = member ? await caller.rpc("room_member_role", { p_room_id: member.room_id }) : { data: null };
    if (!member || (isInternal !== true && role !== "owner")) return json({ ok: false, error: "forbidden" }, 403);
    if (member.status === "revoked") return json({ ok: false, error: "member revoked" }, 400);
    if (member.side === "client" && isInternal !== true && role === "owner" && member.status !== "invited") {
      return json({ ok: false, error: "only outstanding invitations can be re-sent" }, 400);
    }

    const { data: room } = await admin.from("rooms").select("*").eq("id", member.room_id).single();
    const { data: byUser } = await admin.from("room_members").select("full_name").eq("room_id", member.room_id).eq("user_id", userData.user.id).maybeSingle();
    const { data: byMail } = byUser ? { data: null } : await admin.from("room_members").select("full_name").eq("room_id", member.room_id).eq("email", (userData.user.email ?? "").toLowerCase()).maybeSingle();
    const inviter = byUser?.full_name || byMail?.full_name || "ActiveApps";
    const lang = (room.language === "he" ? "he" : "en") as "he" | "en";
    const s = STR[lang];
    const next = `/r/${room.slug}`;

    // staff invited on the client side of a room would lose CRM access — refuse
    if (member.side === "client") {
      const { data: isStaff } = await admin.rpc("is_staff_email", { p_email: member.email });
      if (isStaff === true) return json({ ok: false, error: "this e-mail belongs to a CRM staff profile; invite them on the ActiveApps side instead" }, 400);
    }
    // ensure an auth user exists for the invitee (so magic links with shouldCreateUser=false work later)
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: member.email,
      options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (linkErr) {
      // user may not exist yet → create, then generate
      // app_metadata.kind = 'room_client' is what keeps a client out of is_internal()
      // and out of the CRM's handle_new_user() profile creation.
      const { error: createErr } = await admin.auth.admin.createUser({ email: member.email, email_confirm: true, app_metadata: { kind: "room_client" }, user_metadata: { full_name: member.full_name, room_slug: room.slug } });
      if (createErr && !/already/i.test(createErr.message)) return json({ ok: false, error: createErr.message }, 500);
    }
    const { data: link2, error: linkErr2 } = link ? { data: link, error: null } : await admin.auth.admin.generateLink({
      type: "magiclink", email: member.email, options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (linkErr2 || !link2) return json({ ok: false, error: linkErr2?.message ?? "could not generate link" }, 500);

    const tokenHash = link2.properties?.hashed_token;
    // the callback carries the e-mail so an expired token recovers in one tap (login is prefilled)
    const signInUrl = tokenHash
      ? `${APP_URL}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=${encodeURIComponent(next)}&email=${encodeURIComponent(member.email)}`
      : link2.properties?.action_link ?? `${APP_URL}/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(member.email)}`;

    const mail = await sendMail({
      to: member.email,
      subject: s.subject(inviter, room.client_name),
      heading: s.heading(room.client_name),
      bodyHtml: s.body(inviter, room.name, room.welcome_message ? String(room.welcome_message).split("\n")[0] : null),
      ctaLabel: s.cta,
      ctaUrl: signInUrl,
      lang,
      footer: s.footer,
    });

    let channel = "email";
    let sendError: string | null = null;
    if (mail.skipped) {
      // no Resend yet: let Supabase send its own magic-link e-mail (the user now exists)
      const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { error: otpErr } = await anonClient.auth.signInWithOtp({ email: member.email, options: { emailRedirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}&email=${encodeURIComponent(member.email)}`, shouldCreateUser: false } });
      channel = "supabase_auth_email";
      sendError = otpErr?.message ?? null;
    } else if (!mail.ok) {
      sendError = mail.error ?? "send failed";
    }

    await admin.from("room_notifications").insert({
      room_id: member.room_id, member_id: member.id, channel: "email", status: sendError ? "failed" : "sent", sent_at: sendError ? null : new Date().toISOString(),
      payload: { kind: "invite", provider: channel, message_id: mail.id ?? null, error: sendError },
    });
    if (sendError) return json({ ok: false, error: sendError, channel }, 502);

    return json({ ok: true, channel });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
