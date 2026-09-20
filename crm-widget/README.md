# CRM "Room" widget

Two paste-ready pieces for the ActiveApps CRM (spec §4.11):

1. `RoomWidget.tsx` → copy to the CRM repo `src/components/RoomWidget.tsx`.
2. In `src/pages/RecordPage.tsx`, next to `<AccountInsights accountId={id} />`:

```tsx
import RoomWidget from "../components/RoomWidget";
…
{objectName === "accounts" && <RoomWidget accountId={id} />}
{objectName === "opportunities" && <RoomWidget opportunityId={id} accountId={record?.account_id} />}
```

The widget calls the `room_crm_widget(p_account_id, p_opportunity_id)` RPC from
`supabase/migrations/20260920000700_room_notifications.sql` (internal staff only) and links to
`rooms.activeapps.io`. "Create room" opens the Rooms admin with the account preselected.
