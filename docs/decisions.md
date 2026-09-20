# Decision log — ActiveApps Rooms

| Date | Decision | Why |
|---|---|---|
| 2026-09-20 | `timestamptz` for `room_*` tables | New codebase; no cross-sorting with CRM bigint-ms columns; spec §11.4 recommendation |
| 2026-09-20 | Clients read published snapshots only (`room_document_view`) | Spec §3: draft blocks invisible until publish — enforced in the database, not the UI |
| 2026-09-20 | RPC layer for approvals / publish / invites / answers | One place for permission rules; holds for curl as well as the app |
| 2026-09-20 | Member-row guard trigger + transaction-local bypass flag for RPCs | Lets clients edit `notification_prefs` / NDA acceptance without being able to change role, side, status or expiry |
| 2026-09-20 | CRM hardening = wrap every existing `authenticated` policy in `is_internal() and (…)` | Preserves each policy's intent (own-rows stays own-rows); backup table `crm_policy_backup` for rollback |
| 2026-09-20 | Implicit auth flow + `token_hash` links | Cross-device magic links (phone from e-mail) — PKCE needs the verifier in the same browser |
| 2026-09-20 | Print stylesheet instead of jsPDF for export | Hebrew/RTL fidelity; identical rendering to what was approved |
| 2026-09-20 | PGlite harness for migrations | Docker not available on the dev machine; harness runs in ~5s in Node |
| open | Product name (Room / Command Room / Workroom) | one string, `app_name` in `src/lib/i18n.ts` |
| open | Legal weight of "Approve the SOW" | check with counsel before relying on it (spec §4.5) |
| 2026-09-20 | Opportunity stage sync is a DB trigger (`room_engagement_crm_sync`), not the `room-crm-sync` Edge Function from the spec | Must hold for any client; no HTTP hop to fail; Slack for the same events goes through `room-notify` |
| 2026-09-20 | Digest cron at 05:00 and 06:00 UTC, function checks for 08:00 Asia/Jerusalem | pg_cron runs in UTC; avoids editing the schedule twice a year for DST |
| 2026-09-20 | Event webhook config lives in `room_settings` (internal-only table), not hardcoded in the trigger | The CRM's `notify_slack` embeds the key in the function body; a table is editable without a migration |
| 2026-09-20 | In-app notifications are written by `room-notify` (service role), clients only mark them read | Keeps the rules in one place; RLS limits clients to their own rows |
| 2026-09-20 | `is_internal()` = active staff profile ∧ JWT `app_metadata.kind ≠ room_client` ∧ not a client member (by id or e-mail); hardened `handle_new_user()` skips room clients and creates unknown sign-ups as inactive | Live CRM trigger gives every new auth user a `member` profile and public e-mail sign-ups are enabled — a profile row alone must never grant staff access |
| 2026-09-20 | CRM storage bucket policies (`attachments`, `documents`) wrapped with `is_internal()` too | They were `TO authenticated USING (bucket_id = …)` — any magic-link client could have read CRM attachments |
| 2026-09-20 | `room-notify` / `room-digest`: verify_jwt on, body untrusted, idempotent per event / per member per 20 h | No way to set function secrets from this machine; replay-safety removes the need for one |
| 2026-09-20 | No `VITE_APP_URL` in production; the app uses `window.location.origin` | Works on the vercel.app alias now and on `rooms.activeapps.io` once DNS is attached, without a redeploy |
| 2026-09-20 | Pre-go-live adversarial review (5 finder lenses → 68 findings, deduplicated to ~40 distinct issues); verification agents were cut short by the account spend limit, so every finding was instead reproduced or refuted in the PGlite harness and fixed there | Harness went from 74 to 118 checks |
| 2026-09-20 | Approval is of a **content hash**: `room_blocks.approved_content_hash` = the hash in the published snapshot the approver saw; `display_status`, `room_sow_readiness` and pending lists derive from the snapshot, never the working copy | An unpublished staff edit can no longer inherit an approval, and clients never see working-copy titles |
| 2026-09-20 | `current_member_id()` honours `expires_at`; staff read/write split (`is_internal_writer()`); client column guards on `room_members` (NDA, visit timestamps) and `room_questions` (status, answer, authorship) | Expired members and read-only staff could act; clients could forge answers or unlock NDA silently |
| 2026-09-20 | `room_invite_member` never upserts for clients (re-send only), refuses staff e-mails on the client side (RPC + trigger), staff can reinstate revoked members explicitly | Client owners could reinstate revoked members, rename staff, or lock staff out of the CRM |
| 2026-09-20 | Hardening loop preserves the implicit USING-as-WITH-CHECK of UPDATE/ALL policies, sets `lock_timeout`, and `is_internal()` is executable by `anon` (returns false) | Rewritten policies must not widen writes or turn anonymous access into function errors |
| 2026-09-20 | `previous_seen_at` / `last_seen_at` pair with a 30-minute session boundary | "What changed since your visit" no longer collapses to "now" on the first page load |
| 2026-09-20 | E-mails and Slack escape every client-written string; notifications skip internal notes, expired members and confidential documents without NDA; digest response carries counts only | Client-controlled HTML/mrkdwn injection and directory disclosure |
