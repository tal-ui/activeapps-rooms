// Local migration + RLS harness on PGlite (WASM Postgres). No Docker needed.
//
//   npx tsx scripts/db-test.ts
//
// It stubs what Supabase provides (auth schema, roles, the CRM tables the room
// tables reference), applies every migration in supabase/migrations in order,
// then runs the Sprint 0 definition-of-done checks as an internal user and as a
// client user. Exit code 1 on any failure.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const INTERNAL_USER = "11111111-1111-1111-1111-111111111111";
const CLIENT_USER = "22222222-2222-2222-2222-222222222222";
const OTHER_CLIENT_USER = "33333333-3333-3333-3333-333333333333";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });

  // ---- Supabase stubs -----------------------------------------------------
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create schema extensions;
    create schema net;
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$ select 1::bigint $$;

    -- CRM tables referenced by room_* (shape matches production)
    create function public.epoch_ms() returns bigint language sql stable as $$ select (extract(epoch from now()) * 1000)::bigint $$;
    create table public.profiles (
      id uuid primary key default gen_random_uuid(), auth_user_id uuid, email varchar not null,
      full_name varchar not null default '', title varchar, role varchar not null default 'member',
      is_active boolean not null default true, created_at bigint not null default epoch_ms(), updated_at bigint not null default epoch_ms());
    create table public.accounts (id varchar primary key default gen_random_uuid()::text, name varchar not null, is_deleted boolean default false);
    create table public.opportunities (id varchar primary key default gen_random_uuid()::text, account_id varchar, name varchar not null, stage varchar not null default 'discovery',
      actual_close_date bigint, updated_at bigint not null default epoch_ms(), is_deleted boolean default false);
    create table public.projects (id varchar primary key default gen_random_uuid()::text, account_id varchar, name varchar not null);
    create table public.integrations (id uuid primary key default gen_random_uuid(), key varchar not null, name varchar not null, connected boolean not null default false, config jsonb not null default '{}');
    create table public.invoices (id varchar primary key default gen_random_uuid()::text, invoice_number varchar, total_amount numeric);
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select coalesce((select role = 'admin' from public.profiles where auth_user_id = auth.uid() limit 1), false) $$;

    -- production-style permissive policies (what §5.3 hardens)
    alter table public.profiles enable row level security;
    alter table public.accounts enable row level security;
    alter table public.opportunities enable row level security;
    alter table public.projects enable row level security;
    alter table public.integrations enable row level security;
    alter table public.invoices enable row level security;
    create policy profiles_read on public.profiles for select to authenticated using (true);
    create policy profiles_self on public.profiles for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
    create policy profiles_admin on public.profiles for all to authenticated using (is_admin()) with check (is_admin());
    create policy "Allow authenticated read on accounts" on public.accounts for select to authenticated using (true);
    create policy "Allow authenticated insert on accounts" on public.accounts for insert to authenticated with check (true);
    create policy "Allow authenticated update on accounts" on public.accounts for update to authenticated using (true) with check (true);
    create policy "Allow authenticated delete on accounts" on public.accounts for delete to authenticated using (true);
    create policy "Allow service_role full access on accounts" on public.accounts for all to service_role using (true) with check (true);
    create policy opp_read on public.opportunities for select to authenticated using (true);
    create policy proj_read on public.projects for select to authenticated using (true);
    create policy integrations_read on public.integrations for select to authenticated using (true);
    create policy integrations_admin on public.integrations for all to authenticated using (is_admin()) with check (is_admin());
    create policy invoices_read on public.invoices for select to authenticated using (true);

    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

    insert into auth.users values ('${INTERNAL_USER}', 'tal@activeapps.io'), ('${CLIENT_USER}', 'dana@client.example'), ('${OTHER_CLIENT_USER}', 'eve@other.example');
    insert into public.profiles (auth_user_id, email, full_name, role) values ('${INTERNAL_USER}', 'tal@activeapps.io', 'Tal Oryon', 'admin');
    insert into public.accounts (id, name) values ('acc-1', 'Acme Ltd');
    insert into public.opportunities (id, account_id, name) values ('opp-1', 'acc-1', 'Acme Foundation');
    insert into public.integrations (key, name, connected, config) values ('slack', 'Slack', true, '{"bot_token":"xoxb-secret"}');
    insert into public.invoices (invoice_number, total_amount) values ('INV-1', 1000);
  `);

  // ---- migrations ---------------------------------------------------------
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  console.log(`Applying ${files.length} migrations`);
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    try {
      await db.exec(sql);
      console.log(`  ✓ ${f}`);
    } catch (e) {
      failures++;
      console.log(`  ✗ ${f}\n    ${(e as Error).message}`);
      process.exit(1);
    }
  }
  // grants for tables created by migrations (Supabase does this via default privileges)
  await db.exec(`grant all on all tables in schema public to authenticated, service_role;`);

  // ---- helpers to impersonate ---------------------------------------------
  const as = async <T = Record<string, unknown>>(user: string | null, email: string | null, fn: () => Promise<T>): Promise<T> => {
    await db.exec(`begin;`);
    try {
      if (user) {
        await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true); select set_config('request.jwt.claims', '${JSON.stringify({ sub: user, email, role: "authenticated" })}', true);`);
      } else {
        await db.exec(`set local role anon;`);
      }
      const r = await fn();
      await db.exec(`commit;`);
      return r;
    } catch (e) {
      await db.exec(`rollback;`);
      throw e;
    }
  };
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  // errors abort the enclosing transaction, so each expectation runs in a savepoint
  const expectError = async (name: string, fn: () => Promise<unknown>, pattern?: RegExp) => {
    await db.exec(`savepoint expect_err;`);
    try {
      await fn();
      await db.exec(`release savepoint expect_err;`);
      check(name, false, "expected an error, got success");
    } catch (e) {
      const msg = (e as Error).message;
      await db.exec(`rollback to savepoint expect_err;`);
      check(name, pattern ? pattern.test(msg) : true, msg);
    }
  };

  // ---- Sprint 0 DoD --------------------------------------------------------
  console.log("\nInternal user: create room, engagement from template, publish");
  let roomId = "", engId = "", docId = "", clientMemberId = "", tplId = "";
  await as(INTERNAL_USER, "tal@activeapps.io", async () => {
    const [r] = await q(`select * from public.room_create('Acme × ActiveApps', 'Acme Ltd', 'acme', 'en', 'acc-1', 'Welcome, Dana.')`);
    roomId = r.id as string;
    check("room_create returns a room", !!roomId);
    const [t] = await q(`select id from public.room_templates where name = 'Foundation (EN)'`);
    tplId = t.id as string;
    const [e] = await q(`select public.room_create_engagement_from_template($1, $2, 'Foundation', 'opp-1') as r`, [roomId, tplId]);
    engId = (e.r as Record<string, string>).engagement_id;
    docId = (e.r as Record<string, string>).document_id;
    check("engagement + SOW created from template", !!engId && !!docId);
    const [{ n }] = await q(`select count(*)::int as n from public.room_blocks where document_id = $1`, [docId]);
    check("template blocks inserted", (n as number) > 10, n);
    const [m] = await q(`select * from public.room_invite_member($1, 'dana@client.example', 'Dana Levi', 'COO', 'owner', 'client')`, [roomId]);
    clientMemberId = m.id as string;
    check("client owner invited", m.status === "invited" && m.role === "owner");
    const [phase] = await q(`select phase from public.rooms where id = $1`, [roomId]);
    check("room phase is prospect", phase.phase === "prospect");
    const [pub] = await q(`select public.room_publish_version($1, null) as r`, [docId]);
    check("publish v1", (pub.r as Record<string, unknown>).version === 1, pub.r);
    const [eng] = await q(`select status from public.room_engagements where id = $1`, [engId]);
    check("engagement moved to shared on publish", eng.status === "shared");
    const [live] = await q(`select public.room_document_view($1, 0) as v`, [docId]);
    check("internal can read working copy (version 0)", Array.isArray((live.v as Record<string, unknown>).blocks));
  });

  console.log("\nClient user (before hardening would have seen the CRM)");
  await as(CLIENT_USER, "dana@client.example", async () => {
    for (const t of ["profiles", "accounts", "opportunities", "projects", "integrations", "invoices"]) {
      const [{ n }] = await q(`select count(*)::int as n from public.${t}`);
      check(`0 rows from CRM table ${t}`, n === 0, n);
    }
    await expectError("client cannot insert into accounts", () => q(`insert into public.accounts (id, name) values ('x', 'X')`));
    const [{ n: fnCount }] = await q(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_admin'`);
    check("is_admin still exists (untouched)", fnCount === 1);

    const rooms = await q(`select id, slug from public.rooms`);
    check("client sees exactly their room", rooms.length === 1 && rooms[0].slug === "acme", rooms);
    const claimed = await q(`select * from public.room_claim_membership()`);
    check("membership claimed on first visit", claimed.length === 1 && claimed[0].status === "active" && claimed[0].user_id === CLIENT_USER);
    const [home] = await q(`select public.room_home('acme') as h`);
    const h = home.h as Record<string, unknown>;
    check("room_home returns payload", !!h && (h.room as Record<string, unknown>).slug === "acme");
    check("room_home lists pending blocks for approver", Array.isArray(h.my_pending_blocks) && (h.my_pending_blocks as unknown[]).length > 0, (h.my_pending_blocks as unknown[]).length);

    const blocks = await q(`select id from public.room_blocks`);
    check("client cannot read room_blocks directly", blocks.length === 0, blocks.length);
    const [view] = await q(`select public.room_document_view($1, null) as v`, [docId]);
    const v = view.v as Record<string, unknown>;
    check("client reads published snapshot via room_document_view", (v.blocks as unknown[]).length > 10 && v.version === 1);
    await expectError("client cannot read the working copy", () => q(`select public.room_document_view($1, 0)`, [docId]), /not allowed/);

    const versions = await q(`select version from public.room_document_versions`);
    check("client sees published version rows", versions.length === 1);

    const [firstDeliverable] = await q(`select (b->>'id') as id from jsonb_array_elements($1::jsonb) b where b->>'type' = 'deliverable' limit 1`, [JSON.stringify(v.blocks)]);
    const [appr] = await q(`select public.room_approve_block($1) as r`, [firstDeliverable.id]);
    check("owner approves a block", (appr.r as Record<string, unknown>).status === "agreed");

    await q(`insert into public.room_comments (room_id, document_id, block_id, author_member_id, body) values ($1, $2, $3, $4, 'Looks good')`, [roomId, docId, firstDeliverable.id, clientMemberId]);
    check("client can comment", true);
    await expectError("client cannot write internal_only", () =>
      q(`insert into public.room_comments (room_id, document_id, block_id, author_member_id, body, internal_only) values ($1, $2, $3, $4, 'secret', true)`, [roomId, docId, firstDeliverable.id, clientMemberId]));
    await expectError("client cannot impersonate another author", () =>
      q(`insert into public.room_comments (room_id, document_id, author_member_id, body) values ($1, $2, (select id from public.room_members where side = 'activeapps' limit 1), 'spoof')`, [roomId, docId]));
    await q(`insert into public.room_questions (room_id, document_id, block_id, title, asked_by_member_id, owner_member_id) values ($1, $2, $3, 'Who owns data export?', $4, (select id from public.room_members where side = 'activeapps' and room_id = $1 limit 1))`, [roomId, docId, firstDeliverable.id, clientMemberId]);
    check("client can ask a question", true);
    await expectError("client cannot approve the SOW while blocks are pending", () => q(`select public.room_approve_sow($1, 'ua')`, [engId]), /still need approval/);
    await expectError("client cannot publish", () => q(`select public.room_publish_version($1)`, [docId]), /not allowed/);
    await expectError("client owner cannot invite an ActiveApps admin", () => q(`select public.room_invite_member($1, 'x@y.example', 'X', null, 'admin', 'activeapps')`, [roomId]), /client owner/);
    const [inv] = await q(`select * from public.room_invite_member($1, 'colleague@client.example', 'Yoav', null, 'commenter', 'client')`, [roomId]);
    check("client owner can invite a colleague", inv.role === "commenter");
    // self-update guard
    await q(`update public.room_members set role = 'owner', side = 'activeapps', notification_prefs = '{"digest":"daily"}' where id = $1`, [clientMemberId]);
    const [me] = await q(`select side, role, notification_prefs from public.room_members where id = $1`, [clientMemberId]);
    check("client can update own prefs but not side/role", me.side === "client" && me.role === "owner" && (me.notification_prefs as Record<string, string>).digest === "daily", me);
  });

  console.log("\nInternal: internal-only comment is invisible to the client; agreed block edited flips to changed");
  let internalCommentId = "";
  await as(INTERNAL_USER, "tal@activeapps.io", async () => {
    const [c] = await q(`insert into public.room_comments (room_id, document_id, author_member_id, body, internal_only) values ($1, $2, (select id from public.room_members where room_id = $1 and side = 'activeapps' limit 1), 'internal note', true) returning id`, [roomId, docId]);
    internalCommentId = c.id as string;
    const [b] = await q(`select id, content from public.room_blocks where document_id = $1 and status = 'agreed' limit 1`, [docId]);
    await q(`update public.room_blocks set content = content || '{"description":"edited after approval"}' where id = $1`, [b.id]);
    const [after] = await q(`select status from public.room_blocks where id = $1`, [b.id]);
    check("agreed block edited -> changed", after.status === "changed", after);
    const [{ n }] = await q(`select count(*)::int as n from public.room_questions where room_id = $1 and status = 'open'`, [roomId]);
    check("internal sees the client's question", n === 1);
    const [qq] = await q(`select id from public.room_questions where room_id = $1 limit 1`, [roomId]);
    const [ans] = await q(`select public.room_answer_question($1, 'Dana owns the export; we provide the template.', null) as r`, [qq.id]);
    check("answering a question records a decision", !!(ans.r as Record<string, unknown>).decision_id);
  });

  await as(CLIENT_USER, "dana@client.example", async () => {
    const [{ n }] = await q(`select count(*)::int as n from public.room_comments where id = $1`, [internalCommentId]);
    check("client cannot see internal_only comment", n === 0);
    const [{ d }] = await q(`select count(*)::int as d from public.room_decisions where room_id = $1`, [roomId]);
    check("client sees the decision log", d === 1);
    const events = await q(`select type, client_visible from public.room_events where room_id = $1`, [roomId]);
    check("client sees only client_visible events", events.every((e) => e.client_visible === true) && events.length > 0);
  });

  console.log("\nOther client: sees nothing");
  await as(OTHER_CLIENT_USER, "eve@other.example", async () => {
    const rooms = await q(`select id from public.rooms`);
    check("non-member sees 0 rooms", rooms.length === 0);
    const [home] = await q(`select public.room_home('acme') as h`);
    check("room_home returns null for non-member", home.h === null);
    await expectError("non-member cannot view the document", () => q(`select public.room_document_view($1)`, [docId]), /not allowed/);
    const members = await q(`select id from public.room_members`);
    check("non-member sees 0 members", members.length === 0);
  });

  console.log("\nSprint 4: settings, CRM sync, access state, in-app notifications, CRM widget");
  await as(CLIENT_USER, "dana@client.example", async () => {
    const settings = await q(`select key from public.room_settings`);
    check("client cannot read room_settings", settings.length === 0, settings.length);
    await expectError("client cannot call room_crm_widget", () => q(`select public.room_crm_widget('acc-1', null)`), /not allowed/);
    const [st] = await q(`select public.room_access_state('acme') as s`);
    check("access state ok for active member", (st.s as Record<string, string>).state === "ok", st.s);
    const [none] = await q(`select public.room_access_state('nope') as s`);
    check("access state none for unknown room", (none.s as Record<string, string>).state === "none");
    // in-app notification round trip (rows are normally written by room-notify with the service role)
    await db.exec(`set local role service_role;`);
    await q(`insert into public.room_notifications (room_id, member_id, channel, status, payload) values ($1, $2, 'in_app', 'pending', '{"kind":"test"}')`, [roomId, clientMemberId]);
    await db.exec(`set local role authenticated;`);
    const unread = await q(`select id from public.room_notifications where channel = 'in_app' and status <> 'read'`);
    check("client sees own in-app notification", unread.length === 1);
    const [{ n }] = await q(`select public.room_mark_notifications_read(null, $1) as n`, [roomId]);
    check("mark read updates own rows", n === 1, n);
  });
  await as(INTERNAL_USER, "tal@activeapps.io", async () => {
    // approve remaining blocks as the client would, then approve the SOW → CRM stage
    await db.exec(`set local role service_role;`);
    await q(`update public.room_blocks set status = 'agreed', approved_by_member_id = $2, approved_at = now(), approved_version = 1 where document_id = $1 and deleted_at is null and public.room_block_is_approvable(type)`, [docId, clientMemberId]);
    await db.exec(`set local role authenticated;`);
    const [w] = await q(`select public.room_crm_widget('acc-1', null) as w`);
    const widget = w.w as Record<string, unknown>;
    check("room_crm_widget finds the room by account", (widget.room as Record<string, string>)?.slug === "acme", widget);
    check("room_crm_widget readiness ready", (widget.readiness as Record<string, boolean>)?.ready === true, widget.readiness);
  });
  await as(CLIENT_USER, "dana@client.example", async () => {
    const [r] = await q(`select public.room_approve_sow($1, 'harness-ua') as r`, [engId]);
    check("client approves the SOW", (r.r as Record<string, string>).status === "agreed", r.r);
  });
  await as(INTERNAL_USER, "tal@activeapps.io", async () => {
    const [opp] = await q(`select stage from public.opportunities where id = 'opp-1'`);
    check("CRM opportunity moved to negotiation on agreed", opp.stage === "negotiation", opp);
    const [{ n: synced }] = await q(`select count(*)::int as n from public.room_events where room_id = $1 and type = 'crm_synced'`, [roomId]);
    check("crm_synced event emitted (staff-only)", synced === 1);
    await q(`update public.room_engagements set status = 'signed' where id = $1`, [engId]);
    const [opp2] = await q(`select stage, actual_close_date from public.opportunities where id = 'opp-1'`);
    check("CRM opportunity closed_won on signed", opp2.stage === "closed_won" && !!opp2.actual_close_date, opp2);
    const [eng] = await q(`select signed_at from public.room_engagements where id = $1`, [engId]);
    check("signed_at stamped", !!eng.signed_at);
    const [phase] = await q(`select phase from public.rooms where id = $1`, [roomId]);
    check("room phase stays prospect until active", phase.phase === "prospect", phase);
    await q(`update public.room_engagements set status = 'active' where id = $1`, [engId]);
    const [phase2] = await q(`select phase from public.rooms where id = $1`, [roomId]);
    check("room phase becomes active", phase2.phase === "active", phase2);
    // expire the client and check the renewal path
    await q(`update public.room_members set expires_at = now() - interval '1 hour' where id = $1`, [clientMemberId]);
  });
  await as(CLIENT_USER, "dana@client.example", async () => {
    const [st] = await q(`select public.room_access_state('acme') as s`);
    check("access state expired", (st.s as Record<string, string>).state === "expired", st.s);
    const rooms = await q(`select id from public.rooms`);
    check("expired member sees 0 rooms", rooms.length === 0);
    const [req] = await q(`select public.room_request_renewal('acme') as r`);
    check("renewal request accepted", (req.r as Record<string, boolean>).ok === true, req.r);
    const [again] = await q(`select public.room_request_renewal('acme') as r`);
    check("renewal request deduplicated within a day", (again.r as Record<string, boolean>).already_requested === true, again.r);
  });
  await as(INTERNAL_USER, "tal@activeapps.io", async () => {
    const [{ n }] = await q(`select count(*)::int as n from public.room_events where room_id = $1 and type = 'access_expired_requested'`, [roomId]);
    check("exactly one access_expired_requested event", n === 1, n);
  });

  console.log("\nAnon: nothing at all");
  await as(null, null, async () => {
    await expectError("anon cannot select rooms", () => q(`select id from public.rooms`));
    await expectError("anon cannot call room_home", () => q(`select public.room_home('acme')`));
  });

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  await db.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
