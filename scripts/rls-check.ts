// Sprint 0 definition-of-done check against the REAL Supabase project.
//
//   cp env.example .env   # fill SUPABASE_*, RLS_TEST_CLIENT_*
//   npm run rls:check
//
// Signs in as a throw-away CLIENT user (created on the fly with the service
// role key if it does not exist, no room membership) and verifies that it gets
// 0 rows from every CRM table, cannot see any room, and cannot write
// internal_only comments. Then, if RLS_TEST_ROOM_SLUG is set, invites the test
// user to that room and verifies it sees exactly that room and nothing else.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anon = process.env.SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.RLS_TEST_CLIENT_EMAIL!;
const password = process.env.RLS_TEST_CLIENT_PASSWORD!;
const roomSlug = process.env.RLS_TEST_ROOM_SLUG;

if (!url || !anon || !email || !password) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / RLS_TEST_CLIENT_EMAIL / RLS_TEST_CLIENT_PASSWORD");
  process.exit(2);
}

const CRM_TABLES = [
  "accounts", "contacts", "leads", "opportunities", "opportunity_line_items", "projects", "tasks", "time_entries",
  "invoices", "invoice_line_items", "invoice_payments", "quotes", "quote_line_items", "services", "recurring_invoices",
  "monthly_summaries", "profiles", "integrations", "webhooks", "webhook_deliveries", "automation_rules", "audit_log",
  "activities", "attachments", "documents", "notifications", "custom_fields", "custom_field_values", "page_layouts",
  "saved_views", "record_tags", "email_log", "workspace_settings", "invoice_projects",
];

let failures = 0;
const ok = (name: string, pass: boolean, detail?: unknown) => {
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${!pass && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!pass) failures++;
};

async function main() {
  // ensure the test user exists (service role only; never shipped to the browser)
  if (service) {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const exists = list?.users.some((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!exists) {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) { console.error("could not create test user:", error.message); process.exit(2); }
      console.log(`created test user ${email}`);
    }
  }

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) { console.error("sign-in failed:", signErr.message); process.exit(2); }
  console.log(`signed in as ${email}\n`);

  const { data: internal } = await client.rpc("is_internal");
  ok("test user is not internal", internal === false, internal);

  console.log("CRM tables");
  for (const t of CRM_TABLES) {
    const { data, error } = await client.from(t).select("*").limit(5);
    // either an RLS-filtered empty result or a permission error is a pass; rows are a fail
    ok(`0 rows from ${t}`, !!error || (data ?? []).length === 0, error ? error.message : data);
  }
  const { error: insErr } = await client.from("accounts").insert({ name: "rls-probe", owner_id: "x", created_by_id: "x" });
  ok("cannot insert into accounts", !!insErr);

  console.log("\nRooms (no membership)");
  const { data: rooms } = await client.from("rooms").select("id, slug");
  ok("0 rooms visible", (rooms ?? []).length === 0, rooms);
  const { data: members } = await client.from("room_members").select("id");
  ok("0 members visible", (members ?? []).length === 0);
  const { data: blocks } = await client.from("room_blocks").select("id");
  ok("0 blocks visible", (blocks ?? []).length === 0);
  const { data: tpl, error: tplErr } = await client.from("room_templates").select("id");
  ok("0 templates visible", !!tplErr || (tpl ?? []).length === 0);

  if (roomSlug && service) {
    console.log(`\nRooms (invited to ${roomSlug})`);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: room } = await admin.from("rooms").select("id").eq("slug", roomSlug).single();
    if (!room) { ok("test room exists", false, roomSlug); }
    else {
      await admin.from("room_members").upsert({ room_id: room.id, email: email.toLowerCase(), full_name: "RLS Test", side: "client", role: "commenter", status: "invited" }, { onConflict: "room_id,email" });
      await client.rpc("room_claim_membership");
      const { data: mine } = await client.from("rooms").select("slug");
      ok("sees exactly the invited room", (mine ?? []).length === 1 && mine![0].slug === roomSlug, mine);
      const { data: home } = await client.rpc("room_home", { p_slug: roomSlug });
      ok("room_home returns a payload", !!home);
      const me = (home as { me?: { id: string } } | null)?.me;
      const { error: intErr } = await client.from("room_comments").insert({ room_id: room.id, author_member_id: me?.id, body: "probe", internal_only: true });
      ok("cannot write internal_only comment", !!intErr);
      const { data: internalComments } = await client.from("room_comments").select("id").eq("internal_only", true);
      ok("cannot read internal_only comments", (internalComments ?? []).length === 0);
      const { data: drafts } = await client.from("room_documents").select("id").eq("status", "draft");
      ok("cannot read draft documents", (drafts ?? []).length === 0);
      // cleanup membership
      await admin.from("room_members").delete().eq("room_id", room.id).eq("email", email.toLowerCase());
    }
  } else {
    console.log("\n(set RLS_TEST_ROOM_SLUG + SUPABASE_SERVICE_ROLE_KEY to also test the member path)");
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
