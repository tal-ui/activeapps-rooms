# ActiveApps Rooms

Deal room that becomes the client portal for the whole engagement (proposal → project → retainer).
One room per client account, engagements accumulate inside it. Same link, same people.

Spec: `docs/spec-v1.md` (product + architecture v1, approved 18.9.2026).

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite 6 · React 19 · TypeScript · Tailwind v4 · react-router 7 · dnd-kit · Supabase JS |
| Backend | The existing **AA CRM** Supabase project (`ndzvqldluzfstowhhkvd`) — `room_*` tables in `public`, RLS by room membership, RPCs for every state transition, Storage bucket `room-files`, Edge Functions |
| Hosting | Vercel → `rooms.activeapps.io` |
| E-mail | Resend (falls back to Supabase Auth e-mails until `RESEND_API_KEY` is set) |

## Layout

```
supabase/migrations/      ordered SQL — schema, helpers, RLS, RPCs, CRM hardening, storage, templates
supabase/functions/       room-invite · room-notify · room-digest (+ _shared: cors, email, slack, strings)
crm-widget/               paste-ready "Room" widget for the CRM Account / Opportunity pages
scripts/db-test.ts        applies every migration on PGlite (WASM Postgres) and runs 46 RLS/flow checks — no Docker
scripts/rls-check.ts      the same definition-of-done against the real project, as a throw-away client user
src/lib/                  supabase client, auth, i18n (all UI strings, he/en), room context, types, formatting
src/pages/                Login, AuthCallback, RoomHome, DocumentPage, QuestionsPage, FilesPage, ActivityPage, admin/*
src/components/           RoomShell (layout, realtime, presence), BlockRenderer, BlockEditor, BlockPanel, ui
```

## Run

```bash
npm install
cp env.example .env        # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (publishable)
npm run dev                # http://localhost:5174
npm run db:test            # local migration + RLS harness (PGlite)
npm run typecheck
```

## Apply to Supabase (Sprint 0 gate)

Migrations are **not** applied automatically — the AA CRM project holds production data.
Apply them in order (Supabase MCP `apply_migration`, dashboard SQL editor, or `supabase db push`):

1. `20260920000100_room_schema.sql` — tables, triggers, lifecycle functions
2. `20260920000150_room_helpers.sql` — `is_internal()`, `is_room_member()`, `current_member_id()` …
3. `20260920000200_room_rls.sql` — policies for `room_*`
4. `20260920000300_room_rpcs.sql` — `room_home`, `room_document_view`, `room_publish_version`, approvals, questions, invites
5. `20260920000400_crm_rls_hardening.sql` — **adds `is_internal()` to every CRM policy** (backup in `crm_policy_backup`) and revokes the anon-executable functions. Review before applying.
6. `20260920000500_room_storage.sql` — bucket + storage policies
7. `20260920000600_room_templates.sql` — Foundation / 90-day / Retainer blueprints (he + en), `room_create`, `room_create_engagement_from_template`
8. `20260920000700_room_notifications.sql` — `room_settings`, the `room_events → room-notify` webhook trigger (pg_net), engagement → Opportunity stage sync, access-state / renewal RPCs, in-app read RPC, pg_cron digest jobs, `room_crm_widget`
9. `20260920000800_room_advisor_fixes.sql` — Security/Performance Advisor follow-ups: pinned search_path, no EXECUTE on trigger functions, tighter helper grants, policy-backup read policy, covering indexes on every room foreign key

All nine are applied to `ndzvqldluzfstowhhkvd` (2026-09-20). `room_settings` is filled: `functions_url` = `https://ndzvqldluzfstowhhkvd.supabase.co/functions/v1`, `functions_key` = the legacy anon JWT, `app_url` = `https://activeapps-rooms.vercel.app` (change to the custom domain once it resolves). Live check: a simulated magic-link client reads 0 rows from every CRM table, storage and every room table; `room-notify` answers 404 for unknown events, `room-digest` honours the 08:00 gate, `room-invite` rejects unauthenticated calls.

After applying, fill `room_settings`: `functions_url` (`https://<ref>.supabase.co/functions/v1`), `functions_key` (the publishable anon key — functions verify the JWT), `app_url`, and check `crm_stage_on_agreed` / `crm_stage_on_signed` against the CRM's stage list (discovery, qualification, proposal, negotiation, closed_won, closed_lost). Slack uses the CRM's `integrations` row (`key = 'slack'`); add a `channels.rooms` entry or the default channel is used.

**Review before apply (2026-09-20):** a five-lens adversarial review of the migrations, RPCs and functions produced 68 findings; all distinct ones were reproduced or refuted in the harness and fixed (approval-by-hash, expiry in `current_member_id`, read-only staff split, client column guards, invite rework, hardening loop corrections, escaping and recipient filtering in the functions). Details in `docs/decisions.md`.

Then: `npm run rls:check` with a test client user, Supabase **Security Advisors**, and Auth settings:
redirect URL allow-list (`https://rooms.activeapps.io/auth/callback`, `http://localhost:5174/auth/callback`),
OTP expiry 900s, rate limits on, leaked-password protection on.

Edge Functions: `supabase functions deploy room-invite room-notify room-digest` with secrets `RESEND_API_KEY`,
`ROOMS_APP_URL`, `ROOMS_EMAIL_FROM`, `ROOMS_EMAIL_REPLY_TO`. Until `RESEND_API_KEY` is set, e-mails are skipped
(recorded in `room_notifications` with `skipped: true`) and invitations fall back to Supabase Auth e-mails.
Manual digest test: `POST /functions/v1/room-digest` with `{"force": true}`.

## Go-live status (2026-09-20)

| Step | State |
|---|---|
| Vercel project `activeapps-rooms` (team Tal's projects) | **live** at https://activeapps-rooms.vercel.app — env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable), `VITE_CRM_URL`; the app uses its own origin for links |
| Custom domain `rooms.activeapps.io` | attached to the Vercel project (2026-09-20) but **not resolving yet** — add a CNAME `rooms → cname.vercel-dns.com` at the `activeapps.io` DNS host (same host that points `crm`). Afterwards: `update public.room_settings set value = 'https://rooms.activeapps.io' where key = 'app_url';` and add the custom-domain callback to the Auth redirect list |
| Supabase migrations | **applied** 2026-09-20 (all nine) after the adversarial review below; `room_settings` filled; Security Advisors run — remaining findings are the CRM's pre-existing ones (24 mutable search_path functions, `is_admin` / `current_profile_id` / `current_user_is_read_only` callable by anon, leaked-password protection off) |
| Edge Functions `room-invite`, `room-notify`, `room-digest` | **deployed** (version 2, `verify_jwt = true`; redeploys via MCP need `import_map_path: "deno.json"`); `RESEND_API_KEY`, `ROOMS_EMAIL_FROM`, `ROOMS_EMAIL_REPLY_TO`, `ROOMS_APP_URL` secrets: **manual** (Dashboard → Edge Functions → Secrets) — until then invitations go out through Supabase Auth's own e-mail and other e-mails are recorded as skipped |
| Auth settings | **manual** (Dashboard → Authentication): Site URL = app URL; Redirect URLs = `https://activeapps-rooms.vercel.app/auth/callback`, `https://rooms.activeapps.io/auth/callback`, `http://localhost:5174/auth/callback`; Email OTP expiry 900 s; **disable "Allow new users to sign up"** (public sign-ups are currently ON and `handle_new_user()` creates a profile for every sign-up — the hardening makes such profiles inactive, but closing the door is better); enable leaked-password protection; keep rate limits on |
| GitHub `tal-ui/activeapps-rooms` | **pushed** (`main`, tracking `origin/main`). This clone uses the dedicated key via a repo-local setting: `git config core.sshCommand "ssh -i ~/.ssh/id_ed25519_aa_crm -o IdentitiesOnly=yes"` — repeat it on a fresh clone. Vercel git connection: **active** — pushes to `main` deploy to production (verified: the first push produced a READY deployment) |

## Decisions recorded

- **Timestamps are `timestamptz`** in all `room_*` tables (spec §11.4). The CRM uses bigint-ms; the two never sort across each other. FKs into the CRM (`accounts`, `opportunities`, `projects`) keep the CRM's `character varying` ids.
- **Clients never read `room_blocks` directly.** The working copy is staff-only; clients read published snapshots (`room_document_versions`) through `room_document_view()`, which merges live approval status and counters. Unpublished edits are invisible even via the REST API.
- **`is_internal()` is three-way**: active staff profile **and** JWT `app_metadata.kind ≠ room_client` **and** not a client-side member of any room (by user id or e-mail). The CRM's `handle_new_user()` trigger creates a profile for every new auth user, so a profile alone can never mean staff; unknown sign-ups now get `is_active = false`.
- **`room-notify` / `room-digest` are replay-safe instead of secret-protected**: the event is re-read from the database by id and processed at most once (`room_notifications.event_id`); the digest sends at most once per member per 20 h. A forged call to either function cannot send anything new.
- **Every client-triggered transition is an RPC** (`room_approve_block`, `room_approve_sow`, `room_select_pricing_option`, `room_accept_nda`, `room_answer_question`, `room_invite_member`) with its own permission check. Direct table writes for clients are limited to comments, questions, view events, block views, and their own member row (column-guarded by trigger).
- **Events are emitted by triggers/RPCs**, never trusted from the client, so `room-notify` (sprint 4) sees the same stream whatever client wrote the row.
- **Magic links use the implicit flow + `token_hash` verification** so a link requested on a laptop opens on a phone.
- **PDF export = print stylesheet** (`window.print()`), not jsPDF: Hebrew shaping and RTL come free from the browser, and the output is the same rendering the client reviewed. The CRM's jsPDF approach stays for invoices.
- **`room-crm-sync` is a database trigger, not an Edge Function.** The Opportunity stage must follow the engagement whatever client changed it; Slack for the same events goes through `room-notify`.
- **Digest timing**: pg_cron fires at 05:00 and 06:00 UTC; `room-digest` only sends when it is 08:00 in Asia/Jerusalem, so DST needs no cron change.
- **Product name** in UI: "ActiveApps Room" (spec §11.1 still open — one string in `src/lib/i18n.ts`).

## Sprint status

- [x] Sprint 0 — schema, helpers, RLS, RPCs, CRM hardening migration, storage, app scaffold, auth (magic link + staff password), local harness, production check script
- [x] Sprint 1 — room creation from CRM account, templates, invitations (`room-invite`), room home (status bar, next steps, what changed, team, documents), files with NDA gate
- [x] Sprint 2 — block editor (dnd, autosave), viewer, statuses, publish + diff, block approval, SOW approval, pricing selection, print/PDF
- [x] Sprint 3 — anchored threaded comments, @mentions, internal-only, questions → decisions, activity feed, realtime + presence
- [x] Sprint 4 — `room-notify` (e-mail rules + Slack + in-app), `room-digest` + offer-expiry reminders, Opportunity stage sync, in-app bell + per-member preferences, expired-access renewal flow, CRM "Room" widget
- [ ] Go-live — apply migrations to AA CRM (with sign-off), deploy functions, Resend domain (SPF/DKIM/DMARC), Auth redirect allow-list, Vercel project + `rooms.activeapps.io`, `npm run rls:check`, Security Advisors, pilot with two prospects
