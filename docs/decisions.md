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
