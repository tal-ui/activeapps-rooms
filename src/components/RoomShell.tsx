import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, MessageCircleQuestion, FolderOpen, Activity, Settings2, BarChart3, Eye, EyeOff, LogOut, ExternalLink, Link2 } from "lucide-react";
import { supabase, CRM_URL } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { LangContext, applyDocumentLanguage, translate } from "../lib/i18n";
import { RoomContext, type RoomContextValue } from "../lib/room";
import type { RoomHomePayload, RoomMember } from "../lib/types";
import { FullScreenSpinner, PhaseBadge, Wordmark, Avatar } from "./ui";
import { useToast } from "../lib/toast";
import NotificationBell from "./NotificationBell";

export default function RoomShell({ slug }: { slug: string }) {
  const { isInternal, session, signOut, roomsLoading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [home, setHome] = useState<RoomHomePayload | null | undefined>(undefined);
  const [changes, setChanges] = useState<RoomHomePayload["changes_since_visit"]>([]);
  const [previewAsClient, setPreviewAsClient] = useState(false);
  const [presence, setPresence] = useState<{ member_id: string; name: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<{ state: "ok" | "expired" | "none"; client_name?: string; language?: "he" | "en" } | null>(null);
  const [renewalSent, setRenewalSent] = useState(false);
  const touched = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("room_home", { p_slug: slug });
    if (error) {
      console.error(error);
      setHome(null);
      return;
    }
    setHome((data as RoomHomePayload | null) ?? null);
  }, [slug]);

  // first load: capture "what changed", then touch last_seen and log the visit
  useEffect(() => {
    touched.current = false;
    setHome(undefined);
    (async () => {
      const { data } = await supabase.rpc("room_home", { p_slug: slug });
      const payload = (data as RoomHomePayload | null) ?? null;
      setHome(payload);
      if (!payload) {
        const { data: st } = await supabase.rpc("room_access_state", { p_slug: slug });
        setAccess((st as { state: "ok" | "expired" | "none" } | null) ?? { state: "none" });
      }
      if (payload && !touched.current) {
        touched.current = true;
        setChanges(payload.changes_since_visit ?? []);
        await supabase.rpc("room_touch_last_seen", { p_room_id: payload.room.id });
        if (payload.me) {
          await supabase.from("room_events").insert({
            room_id: payload.room.id,
            actor_member_id: payload.me.id,
            type: "room_viewed",
            entity_type: "room",
            entity_id: payload.room.id,
            client_visible: false,
          });
        }
      }
    })();
  }, [slug]);

  // language on <html>
  const lang = home?.room.language ?? "en";
  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  // realtime: room events + presence
  useEffect(() => {
    if (!home?.room.id) return;
    const roomId = home.room.id;
    const meName = home.me?.full_name || session?.user.email || "";
    const channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: home.me?.id ?? session?.user.id ?? "anon" } } });
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_events", filter: `room_id=eq.${roomId}` }, (payload) => {
        const t = (payload.new as { type?: string }).type ?? "";
        if (!t.endsWith("_viewed")) void load();
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ member_id: string; name: string }>();
        const list: { member_id: string; name: string }[] = [];
        for (const key of Object.keys(state)) {
          const first = state[key][0];
          if (first && key !== (home.me?.id ?? session?.user.id)) list.push({ member_id: first.member_id, name: first.name });
        }
        setPresence(list);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ member_id: home.me?.id ?? "", name: meName, side: home.me?.side ?? "activeapps" });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [home?.room.id, home?.me?.id, home?.me?.full_name, home?.me?.side, session?.user.id, session?.user.email, load]);

  const memberById = useCallback(
    (id: string | null | undefined): RoomMember | undefined => (id ? home?.members.find((m) => m.id === id) : undefined),
    [home?.members],
  );

  const ctx = useMemo<RoomContextValue | null>(() => {
    if (!home) return null;
    return {
      home,
      me: home.me,
      isInternal: home.is_internal,
      previewAsClient,
      setPreviewAsClient,
      staffMode: home.is_internal && !previewAsClient,
      presence,
      refresh: load,
      changes,
      dismissChanges: () => setChanges([]),
      memberById,
    };
  }, [home, previewAsClient, presence, load, changes, memberById]);

  if (home === undefined || roomsLoading) return <FullScreenSpinner />;
  if (home === null || !ctx) return <NoAccess expired={access?.state === "expired"} />;

  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, key, vars);
  const staff = ctx.staffMode;
  const tabs = [
    { to: `/r/${slug}`, end: true, icon: Home, label: t("nav_home") },
    { to: `/r/${slug}/questions`, icon: MessageCircleQuestion, label: t("nav_questions"), count: home.open_questions },
    { to: `/r/${slug}/files`, icon: FolderOpen, label: t("nav_files") },
    { to: `/r/${slug}/activity`, icon: Activity, label: t("nav_activity") },
    ...(staff ? [{ to: `/r/${slug}/engagement`, icon: BarChart3, label: t("nav_engagement") }, { to: `/r/${slug}/settings`, icon: Settings2, label: t("nav_settings") }] : []),
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.push("error", t("error_generic"));
    }
  };

  return (
    <LangContext.Provider value={lang}>
      <RoomContext.Provider value={ctx}>
        <div className="min-h-screen flex flex-col">
          <header className="sticky top-0 z-40 backdrop-blur-xl border-b hairline" style={{ background: "var(--header-bg)" }}>
            <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
              <button className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => navigate(`/r/${slug}`)}>
                {home.room.client_logo_path ? (
                  <ClientLogo path={home.room.client_logo_path} name={home.room.client_name} />
                ) : (
                  <Avatar name={home.room.client_name} size={30} />
                )}
                <span className="truncate font-heading font-semibold text-foreground">{home.room.name}</span>
              </button>
              <PhaseBadge phase={home.room.phase} />
              <div className="flex-1" />
              <nav className="hidden lg:flex items-center gap-1">
                {tabs.map((tab) => (
                  <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `btn btn-sm ${isActive ? "btn-secondary" : "btn-ghost"}`}>
                    <tab.icon size={15} />
                    {tab.label}
                    {tab.count ? <span className="badge badge-mint !py-0">{tab.count}</span> : null}
                  </NavLink>
                ))}
              </nav>
              {home.is_internal && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPreviewAsClient((v) => !v)} title={previewAsClient ? t("exit_preview") : t("preview_as_client")}>
                  {previewAsClient ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span className="hidden sm:inline">{previewAsClient ? t("exit_preview") : t("preview_as_client")}</span>
                </button>
              )}
              {staff && (
                <button className="btn btn-ghost btn-sm" onClick={copyLink} title={t("copy_link")}>
                  <Link2 size={15} />
                  <span className="hidden sm:inline">{copied ? t("copied") : t("copy_link")}</span>
                </button>
              )}
              {staff && home.room.account_id && (
                <a className="btn btn-ghost btn-sm hidden sm:inline-flex" href={`${CRM_URL}/accounts/${home.room.account_id}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} />
                  {t("open_in_crm")}
                </a>
              )}
              <NotificationBell />
              <button className="btn btn-ghost btn-sm" onClick={() => void signOut().then(() => navigate("/login"))} title={t("sign_out")}>
                <LogOut size={15} />
              </button>
              <div className="hidden sm:block ps-2 ms-1 border-s hairline">
                <Wordmark size="sm" />
              </div>
            </div>
            {previewAsClient && (
              <div className="bg-warning/10 text-warning text-xs text-center py-1 font-mono tracking-wider uppercase">{t("preview_as_client")}</div>
            )}
          </header>

          <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 mobile-content-pad">
            <Outlet />
          </main>

          <footer className="hidden lg:block border-t hairline py-4">
            <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-text-faint">
              <span className="flex items-center gap-2"><span className="pulse-dot" />{t("sla_note")}</span>
              <span className="flex items-center gap-3"><Wordmark size="sm" /><span className="label-mono" style={{ color: "#5E6268" }} dir="ltr">Tech Orchestration</span></span>
            </div>
          </footer>

          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t hairline backdrop-blur-xl" style={{ background: "var(--header-bg)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-stretch justify-around h-14">
              {tabs.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 flex-1 text-[0.65rem] font-mono uppercase tracking-wider relative ${isActive ? "text-mint" : "text-text-dim"}`}>
                  <tab.icon size={18} />
                  <span>{tab.label}</span>
                  {tab.count ? <span className="absolute top-1.5 end-[22%] badge badge-mint !py-0 !px-1">{tab.count}</span> : null}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </RoomContext.Provider>
    </LangContext.Provider>
  );

  function NoAccess({ expired }: { expired: boolean }) {
    const uiLang = access?.language ?? ((navigator.language || "en").startsWith("he") ? "he" : "en");
    const tt = (k: Parameters<typeof translate>[1]) => translate(uiLang, k);
    const requestRenewal = async () => {
      const { error } = await supabase.rpc("room_request_renewal", { p_slug: slug });
      if (error) toast.push("error", error.message);
      else setRenewalSent(true);
    };
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6" dir={uiLang === "he" ? "rtl" : "ltr"}>
        <Wordmark size="lg" />
        <h1 className="text-xl font-semibold">{expired ? tt("access_expired_title") : tt("no_rooms_title")}</h1>
        <p className="text-text-mid max-w-md">{expired ? tt("access_expired_body") : tt("no_rooms_body")}</p>
        {expired && (renewalSent ? (
          <p className="text-mint text-sm flex items-center gap-2"><span className="pulse-dot" />{tt("renewal_requested")}</p>
        ) : (
          <button className="btn btn-primary" onClick={requestRenewal}>{tt("request_renewal")}</button>
        ))}
        {isInternal && <button className="btn btn-secondary" onClick={() => navigate("/admin/rooms")}>{tt("nav_rooms")}</button>}
        <button className="btn btn-ghost" onClick={() => void signOut().then(() => navigate("/login"))}>{tt("sign_out")}</button>
      </div>
    );
  }
}

function ClientLogo({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("room-files").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  if (!url) return <Avatar name={name} size={30} />;
  return <img src={url} alt={name} className="h-7 w-auto max-w-[120px] object-contain rounded" />;
}
