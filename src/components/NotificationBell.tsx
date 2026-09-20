import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Settings2, CheckCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtRelative } from "../lib/format";
import { useToast } from "../lib/toast";
import { Field, Modal } from "./ui";

interface Notif { id: string; status: string; created_at: string; payload: { kind?: string; title?: string; url?: string } }

const PREF_KINDS = ["mention", "question_assigned", "question_answered", "version_published", "approved_block_changed", "sow_approved"] as const;
type Pref = "immediate" | "digest" | "off";

export default function NotificationBell() {
  const { home, me, refresh } = useRoom();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const memberId = me?.id;

  const load = useCallback(async () => {
    if (!memberId) return;
    const { data } = await supabase.from("room_notifications").select("id, status, created_at, payload").eq("room_id", home.room.id).eq("member_id", memberId).eq("channel", "in_app").order("created_at", { ascending: false }).limit(30);
    setItems((data as Notif[]) ?? []);
  }, [home.room.id, memberId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!memberId) return;
    const ch = supabase.channel(`notif:${memberId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_notifications", filter: `member_id=eq.${memberId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [memberId, load]);

  if (!me) return null;
  const unread = items.filter((n) => n.status !== "read").length;

  const markAll = async () => {
    await supabase.rpc("room_mark_notifications_read", { p_ids: null, p_room_id: home.room.id });
    await load();
  };
  const openItem = async (n: Notif) => {
    if (n.status !== "read") await supabase.rpc("room_mark_notifications_read", { p_ids: [n.id], p_room_id: home.room.id });
    setOpen(false);
    await load();
    const url = n.payload.url;
    if (url) {
      const rel = url.replace(/^https?:\/\/[^/]+/, "");
      navigate(rel.startsWith("/") ? rel : `/r/${home.room.slug}`);
    }
  };

  return (
    <div className="relative">
      <button className="btn btn-ghost btn-sm relative" onClick={() => setOpen((v) => !v)} aria-label={t("notifications")} aria-expanded={open}>
        <Bell size={15} />
        {unread > 0 && <span className="absolute -top-0.5 -end-0.5 min-w-4 h-4 px-1 rounded-sm bg-mint text-primary-foreground text-[0.6rem] font-mono font-semibold flex items-center justify-center">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 mt-1 w-[min(92vw,22rem)] panel-elevated z-50 shadow-lg animate-slide-in">
            <div className="flex items-center justify-between px-3 py-2 border-b hairline">
              <span className="label-mono">{t("notifications")}</span>
              <div className="flex items-center gap-1">
                {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAll} title={t("mark_all_read")}><CheckCheck size={13} /></button>}
                <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setPrefsOpen(true); }} title={t("notification_prefs")}><Settings2 size={13} /></button>
              </div>
            </div>
            <ul className="max-h-80 overflow-y-auto divide-y divide-white/5">
              {items.length === 0 && <li className="px-3 py-4 text-sm text-text-dim">{t("notifications_empty")}</li>}
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`w-full text-start px-3 py-2.5 hover:bg-navy-surface flex items-start gap-2 ${n.status === "read" ? "opacity-60" : ""}`} onClick={() => openItem(n)}>
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.status === "read" ? "bg-transparent" : "bg-mint"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text-light truncate">{n.payload.title ?? n.payload.kind ?? "—"}</span>
                      <span className="block text-[0.65rem] text-text-faint font-mono">{fmtRelative(n.created_at, lang)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <PrefsModal open={prefsOpen} onClose={() => setPrefsOpen(false)} onSaved={refresh} />
    </div>
  );
}

function PrefsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me } = useRoom();
  const t = useT();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !me) return;
    supabase.from("room_members").select("notification_prefs").eq("id", me.id).single().then(({ data }) => setPrefs(((data?.notification_prefs as Record<string, Pref>) ?? {})));
  }, [open, me]);
  if (!me) return null;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("room_members").update({ notification_prefs: prefs }).eq("id", me.id);
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("prefs_saved"));
    await onSaved();
    onClose();
  };
  const row = (key: string, label: string, options: Pref[]) => (
    <div key={key} className="flex items-center justify-between gap-3 py-2 border-b hairline last:border-0">
      <span className="text-sm text-text-light">{label}</span>
      <select className="select !w-auto !py-1 text-xs" value={prefs[key] ?? "immediate"} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value as Pref })}>
        {options.map((o) => <option key={o} value={o}>{t(`pref_${o}` as "pref_immediate")}</option>)}
      </select>
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={t("notification_prefs")}>
      <p className="text-sm text-text-mid mb-3">{t("prefs_intro")}</p>
      <Field label={t("notifications")}>
        <div className="panel px-3">
          {PREF_KINDS.map((k) => row(k, t(`pref_${k}` as "pref_mention"), ["immediate", "digest", "off"]))}
          {row("digest", t("pref_digest_row"), ["immediate", "off"])}
        </div>
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{t("save")}</button>
      </div>
    </Modal>
  );
}
