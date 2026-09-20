# ActiveApps Room — Product & Architecture Spec v1 (English working copy)

Status: approved for build (18 Sep 2026) · Owner: Tal Oryon · Source: Hebrew spec v1.0 supplied with the build request.

## 0. Summary and approved decisions
- The Room is ActiveApps' first deliverable: the client experiences the quality of the work before signing.
- The room does not end at signature. One room per client (Account); Engagements (offer → project → retainer) accumulate inside it. Same link, same people.
- v1 scope: room + block-based SOW with statuses + block-anchored comments + open questions with owners + notifications (e-mail to client, Slack to ActiveApps) + magic-link sign-in + activity feed + link to the CRM Opportunity.
- Out of v1 (deliberately): modular pricing with live totals, Mutual Action Plan, e-signature, AI layer, advanced engagement analytics, WhatsApp, multi-tenant.
- Architecture: separate app (`rooms.activeapps.io`) on the same Supabase project as CRM 3.0 (AA CRM), own `room_*` tables, RLS by room membership. Hard prerequisite: harden CRM RLS before inviting the first client (§5.3).

## 1. Principles
1. The room demonstrates how ActiveApps works — every feature must show structured, transparent, automated, AI-assisted work.
2. Three perfect moments over forty features: first open, first reply, return to the room.
3. Continuity: same link, people, language from offer to retainer.
4. Questions and decisions are objects, not comments.
5. Built as a product from day one (`org_id` on every table) but v1 is single-tenant.

## 2. Users and roles
| Side | Role | Can |
|---|---|---|
| ActiveApps | admin | everything incl. delete rooms, integration settings |
| ActiveApps | member | everything except delete rooms / integration settings |
| Client | owner | view, comment, ask, approve blocks & SOW, invite colleagues |
| Client | approver | view, comment, ask, approve blocks & SOW |
| Client | commenter | view, comment, ask |
| Client | viewer | view only |

Staff sign in with the CRM account (Supabase Auth + `profiles`). Clients sign in with a magic link (no password); the member row is created from an invitation and linked to `user_id` by e-mail on first visit. A client owner inviting a colleague creates an `invited` member and notifies ActiveApps on Slack.

## 3. Entities
Room (phase prospect → active → retainer → dormant | closed, derived from engagements) · Engagement (type foundation | transformation_90d | retainer | custom; status draft → shared → agreed → signed → active → completed | cancelled; one SOW, optional offer/attachments, `opportunity_id`) · Document (kind sow | offer | msa | dpa | nda | discovery | plan | file) · Block (types heading, text, deliverable, assumption, milestone, pricing_option, pricing_line, callout, file, image, table, divider; status draft → in_review → agreed, `changed` when edited after approval) · Document Version (snapshot; diff by block_id + content_hash) · Comment (anchored to block/document/room, threads, @mentions, internal_only, resolve) · Question (title, body, asker, owner, due date, block anchor; open | answered | closed; answering creates a Decision) · Decision · Event · Notification.

## 4. v1 functionality
4.1 Access: `/login` magic link (15 min), branded bilingual; invitation e-mail with direct link; optional member expiry with "request renewal"; NDA gate for confidential documents.
4.2 Room home `/r/:slug`: client logo + wordmark; "Where we stand" bar (phase, engagement + SOW version, open questions, blocks awaiting approval, next milestone / kickoff, offer validity); "Your next steps" personal checklist; "What changed since your last visit" (by `last_seen_at`); personal welcome message (optional video); documents by engagement, team, recent activity. In delivery mode (active+) the bar shows milestones.
4.3 Block document `/r/:slug/doc/:id`: continuous scroll, status tag, comment count, new/changed markers, click → side panel (comments, questions, approve). Staff: form-based editor per block type, drag & drop, duplicate, delete, Markdown, autosave. Templates: Foundation / 90-day / Retainer. Pricing options as cards; owner/approver selects one. Client-side PDF export with version and date.
4.4 Versions & diff: "Publish version" snapshot with change summary (auto-generated default); version picker; "show changes since vN"; approved block edited → changed + notify approver.
4.5 Approvals: per-block approval (member, time, version). "Approve the SOW" when all relevant blocks are agreed: records name, e-mail, time, version, hash, user agent; engagement → agreed; Slack; Opportunity stage update. Commercial approval only — formal signature is v2; check with counsel.
4.6 Comments: threads, @mentions with immediate notification, internal_only enforced by RLS, resolve/unresolve, realtime + presence.
4.7 Questions & decisions `/r/:slug/questions`: create from any block or the room; views open by owner / overdue / answered; answering records a Decision; chronological decision log; "my questions" on home.
4.8 Files `/r/:slug/files`: upload to bucket `room-files`, signed short-lived URLs, PDF preview, confidential flag.
4.9 Notifications: client immediate e-mail (mention, assigned question, answer, new version with summary, approved block changed); daily digest 08:00 Asia/Jerusalem; Slack to ActiveApps for first daily view, client comment/question, block approval, SOW approval, pricing selection, colleague invited, NDA accepted, expired access; in-app bell + unread markers; per-member preferences.
4.10 Activity `/r/:slug/activity` (client sees client_visible only); room/document/block views (dwell ≥ 2s), `last_seen_at`; simple staff "Engagement" panel.
4.11 CRM: `rooms.account_id → accounts`, `room_engagements.opportunity_id → opportunities`; agreed → Opportunity stage + Slack; signed → Won (v1); CRM "Room" widget on Account / Opportunity.

## 5. Technical architecture
Vite + React 19 + TS + Tailwind v4, react-router, dnd-kit, Supabase JS; Dark Command Center tokens. Repo `tal-ui/activeapps-rooms` → Vercel → `rooms.activeapps.io`. Backend: AA CRM Supabase, `room_*` tables, bucket `room-files`, Edge Functions, pg_cron + pg_net. Resend on `notifications@activeapps.io`. Realtime channel per room.
Schema per table: `id uuid, org_id, created_at, updated_at` + fields listed in the spec (implemented in `supabase/migrations/20260920000100_room_schema.sql`).
§5.3 Security prerequisite: `is_internal()`, `is_room_member()`, `current_member_id()`; replace all CRM policies with `is_internal()`; room policies as specified; storage policies; automated check script; Security Advisors; service role only in Edge Functions; closed redirect list; OTP rate limit.
§5.4 Edge Functions: room-notify, room-digest, room-invite, room-crm-sync.

## 6. Design & UX
Dark Command Center (bg #06090F, surfaces rgb(21,27,36), mint #3CC998); Heebo (he), Inter / Space Grotesk (en), JetBrains Mono labels; `dir` by room language, logical CSS only; mobile-first (LCP < 1.5s on 4G); readable long documents on a raised surface; the three moments; skeletons, empty states, subtle motion, presence dot; no light theme in v1.

## 7. Non-functional
200-block document < 1s; realtime < 1s; e-mail < 60s; daily backups; SPF/DKIM/DMARC; room deletion on request (soft delete + purge after 30 days); events retained 12 months; keyboard navigation, contrast, aria.

## 8. Sprints
0 foundations & security · 1 room & members · 2 block SOW · 3 conversation · 4 notifications & CRM (pilot with two prospects).

## 9. Pilot metrics
Share of client comments/questions inside the room (> 60%); time to first ActiveApps reply (< 4 working hours); time from share to agreed; stakeholders invited by the client; return visits per member per week; qualitative feedback.

## 10. v2 / v3
v2: delivery mode (milestones synced with CRM projects/tasks, weekly status, hours & budget, invoices, change requests, retainer balance), live modular pricing, MAP, e-signature, "ask the proposal" (Claude), AI change summaries, SOW drafts from Opportunity data, engagement heatmap, WhatsApp, reply-by-email, PDF page anchors, watermark, light theme. v3: multi-tenant, Salesforce/HubSpot connectors, white-label.

## 11. Open decisions
Product name; domain (`rooms.activeapps.io` recommended); e-mail provider (Resend recommended); timestamps (`timestamptz` chosen); legal weight of SOW approval; access for additional ActiveApps staff in v1.
