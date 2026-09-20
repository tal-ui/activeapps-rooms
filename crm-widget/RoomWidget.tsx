// RoomWidget — paste into the CRM repo at src/components/RoomWidget.tsx and
// render it next to <AccountInsights accountId={id} /> in src/pages/RecordPage.tsx:
//
//   {objectName === "accounts" && <RoomWidget accountId={id} />}
//   {objectName === "opportunities" && <RoomWidget opportunityId={id} accountId={record.account_id} />}
//
// It relies on the room_crm_widget() RPC (supabase/migrations/20260920000700)
// which is internal-only, and on the CRM's existing supabase client + tokens.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const ROOMS_URL = "https://rooms.activeapps.io";

interface Widget {
  room: { id: string; slug: string; name: string; phase: string; language: string; updated_at: string } | null;
  engagement: { id: string; name: string; status: string; agreed_at: string | null; offer_valid_until: string | null } | null;
  sow: { id: string; title: string; current_version: number; status: string } | null;
  readiness: { total: number; agreed: number; pending: number; ready: boolean } | null;
  open_questions: number;
  members: number;
  last_client_seen_at: string | null;
  last_event: { type: string; created_at: string; payload: Record<string, unknown> } | null;
}

function rel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function RoomWidget({ accountId, opportunityId }: { accountId?: string | null; opportunityId?: string | null }) {
  const [w, setW] = useState<Widget | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    supabase.rpc("room_crm_widget", { p_account_id: accountId ?? null, p_opportunity_id: opportunityId ?? null }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { console.error("room_crm_widget", error.message); setW(null); return; }
      setW(data as Widget);
    });
    return () => { alive = false; };
  }, [accountId, opportunityId]);

  if (w === undefined) return null;

  const createHref = `${ROOMS_URL}/admin/rooms?account=${encodeURIComponent(accountId ?? "")}`;

  if (!w || !w.room) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: "var(--surface-border)", background: "var(--card)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="label-mono mb-1">Room</p>
            <p className="text-sm" style={{ color: "var(--text-mid)" }}>No deal room yet for this account.</p>
          </div>
          <a href={createHref} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-md text-sm font-semibold" style={{ background: "var(--mint)", color: "var(--primary-foreground)" }}>Create room</a>
        </div>
      </div>
    );
  }

  const roomHref = `${ROOMS_URL}/r/${w.room.slug}`;
  const stats: [string, string][] = [
    ["Phase", w.room.phase],
    ["Engagement", w.engagement ? `${w.engagement.name} · ${w.engagement.status}` : "—"],
    ["SOW", w.sow ? (w.sow.current_version > 0 ? `v${w.sow.current_version}` : "draft") : "—"],
    ["Approvals", w.readiness ? `${w.readiness.agreed}/${w.readiness.total}` : "—"],
    ["Open questions", String(w.open_questions)],
    ["Client members", String(w.members)],
    ["Last client visit", rel(w.last_client_seen_at)],
    ["Last activity", w.last_event ? `${w.last_event.type.replaceAll("_", " ")} · ${rel(w.last_event.created_at)}` : "—"],
  ];

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--surface-border)", background: "var(--card)" }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="label-mono mb-1">Room</p>
          <p className="text-sm font-medium truncate">{w.room.name}</p>
        </div>
        <a href={roomHref} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-md text-sm font-semibold shrink-0" style={{ background: "var(--mint)", color: "var(--primary-foreground)" }}>Open room</a>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {stats.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="label-mono">{k}</p>
            <p className="text-sm truncate" style={{ color: "var(--text-light)" }}>{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
