import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useRoom } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtDateTime } from "../lib/format";
import { eventLabel } from "../lib/events";
import { Avatar, EmptyState, Skeleton } from "../components/ui";
import type { RoomEvent } from "../lib/types";

export default function ActivityPage() {
  const { home, memberById, staffMode } = useRoom();
  const t = useT();
  const lang = useLang();
  const [events, setEvents] = useState<RoomEvent[] | null>(null);
  const [showViews, setShowViews] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase
      .from("room_events")
      .select("*")
      .eq("room_id", home.room.id)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (alive) setEvents((data as RoomEvent[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [home.room.id]);

  const list = (events ?? []).filter((e) => showViews || !e.type.endsWith("_viewed"));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">{t("activity_title")}</h1>
        {staffMode && (
          <label className="text-xs text-text-dim flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showViews} onChange={(e) => setShowViews(e.target.checked)} /> views
          </label>
        )}
      </div>
      {events === null ? (
        <div className="flex flex-col gap-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState body={t("activity_empty")} />
      ) : (
        <ol className="panel divide-y divide-white/5">
          {list.map((e) => {
            const actor = memberById(e.actor_member_id);
            const p = e.payload as Record<string, string | undefined>;
            return (
              <li key={e.id} className="px-4 py-3 flex items-start gap-3">
                <Avatar name={actor?.full_name} email={actor?.email} side={actor?.side} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-light">
                    <span className="font-medium">{actor?.full_name ?? "ActiveApps"}</span> {eventLabel(e, lang)}
                    {!e.client_visible && staffMode && <span className="badge ms-2">{t("internal_only")}</span>}
                  </p>
                  {e.type === "version_published" && p.change_summary && <p className="text-xs text-text-dim mt-0.5">{p.change_summary}</p>}
                  {e.type === "question_answered" && p.answer && <p className="text-xs text-text-dim mt-0.5">{p.answer}</p>}
                  <p className="text-[0.65rem] text-text-faint mt-1 font-mono">{fmtDateTime(e.created_at, lang)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
