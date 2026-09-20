import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useRoom } from "../../lib/room";
import { useT, useLang } from "../../lib/i18n";
import { fmtDateTime, fmtRelative } from "../../lib/format";
import { Avatar, SectionTitle, Skeleton } from "../../components/ui";
import type { RoomEvent } from "../../lib/types";

interface BlockView { member_id: string; block_id: string; dwell_ms: number; last_seen_at: string }

/** Simple v1 engagement panel for staff: who saw what and when (spec §4.10). */
export default function EngagementPanelPage() {
  const { home, staffMode, memberById } = useRoom();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [views, setViews] = useState<RoomEvent[] | null>(null);
  const [blockViews, setBlockViews] = useState<BlockView[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => { if (!staffMode) navigate(`/r/${home.room.slug}`, { replace: true }); }, [staffMode, navigate, home.room.slug]);

  useEffect(() => {
    (async () => {
      const [ev, bv, docs] = await Promise.all([
        supabase.from("room_events").select("*").eq("room_id", home.room.id).in("type", ["room_viewed", "document_viewed", "file_downloaded"]).order("created_at", { ascending: false }).limit(200),
        supabase.from("room_block_views").select("member_id, block_id, dwell_ms, last_seen_at").eq("room_id", home.room.id).order("dwell_ms", { ascending: false }).limit(200),
        supabase.from("room_blocks").select("id, type, content").eq("room_id", home.room.id).is("deleted_at", null),
      ]);
      setViews((ev.data as RoomEvent[]) ?? []);
      setBlockViews((bv.data as BlockView[]) ?? []);
      const map: Record<string, string> = {};
      for (const b of (docs.data as { id: string; type: string; content: Record<string, string> }[]) ?? []) map[b.id] = b.content.title || b.content.text || b.content.name || b.content.label || b.type;
      setTitles(map);
    })();
  }, [home.room.id]);

  const clients = home.members.filter((m) => m.side === "client");

  return (
    <div className="max-w-4xl flex flex-col gap-8">
      <h1 className="text-lg font-semibold">{t("engagement_panel")}</h1>

      <section>
        <SectionTitle>{t("team")}</SectionTitle>
        <ul className="panel divide-y divide-white/5">
          {clients.map((m) => {
            const mine = (views ?? []).filter((v) => v.actor_member_id === m.id);
            const docsSeen = new Set(mine.filter((v) => v.type === "document_viewed").map((v) => v.entity_id));
            return (
              <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                <Avatar name={m.full_name} email={m.email} side="client" size={30} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{m.full_name || m.email}</p>
                  <p className="text-xs text-text-dim">{m.status} · {m.last_seen_at ? t("last_seen", { when: fmtRelative(m.last_seen_at, lang) }) : t("never_visited")}{m.nda_accepted_at ? ` · ${t("nda_accepted")}` : ""}</p>
                </div>
                <span className="text-xs text-text-dim font-mono">{mine.filter((v) => v.type === "room_viewed").length} visits · {docsSeen.size} docs</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <SectionTitle>{t("engagement_who_saw")}</SectionTitle>
        {views === null ? <Skeleton className="h-24" /> : (
          <ul className="panel divide-y divide-white/5 max-h-[24rem] overflow-y-auto">
            {views.map((v) => {
              const a = memberById(v.actor_member_id);
              const p = v.payload as Record<string, string>;
              return (
                <li key={v.id} className="px-4 py-2 text-xs flex items-center gap-3">
                  <span className="text-text-faint font-mono w-32 shrink-0">{fmtDateTime(v.created_at, lang)}</span>
                  <span className="text-text-light">{a?.full_name ?? "—"}</span>
                  <span className="text-text-dim">{v.type.replaceAll("_", " ")}{p.title ? ` · ${p.title}` : ""}{p.version ? ` v${p.version}` : ""}</span>
                </li>
              );
            })}
            {views.length === 0 && <li className="px-4 py-3 text-sm text-text-dim">{t("activity_empty")}</li>}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Block dwell (top)</SectionTitle>
        <ul className="panel divide-y divide-white/5">
          {blockViews.slice(0, 30).map((b) => (
            <li key={`${b.member_id}-${b.block_id}`} className="px-4 py-2 text-xs flex items-center gap-3">
              <span className="text-text-light w-40 truncate">{memberById(b.member_id)?.full_name ?? "—"}</span>
              <span className="flex-1 truncate text-text-dim">{titles[b.block_id] ?? b.block_id}</span>
              <span className="font-mono text-mint">{Math.round(b.dwell_ms / 1000)}s</span>
              <span className="text-text-faint font-mono">{fmtRelative(b.last_seen_at, lang)}</span>
            </li>
          ))}
          {blockViews.length === 0 && <li className="px-4 py-3 text-sm text-text-dim">—</li>}
        </ul>
      </section>
    </div>
  );
}
