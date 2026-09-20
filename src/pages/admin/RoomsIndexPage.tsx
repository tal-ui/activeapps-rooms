import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, DoorOpen, LogOut } from "lucide-react";
import { supabase, CRM_URL } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useT, useLang, applyDocumentLanguage } from "../../lib/i18n";
import { fmtRelative, slugify } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { EmptyState, Field, Modal, PhaseBadge, Wordmark, Tagline, Skeleton } from "../../components/ui";
import type { Language } from "../../lib/types";

interface AccountRow { id: string; name: string; short_name: string | null }

export default function RoomsIndexPage() {
  const { rooms, roomsLoading, isInternal, profile, refreshRooms, signOut } = useAuth();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetAccount = params.get("account");
  const [createOpen, setCreateOpen] = useState(!!presetAccount);

  useEffect(() => { applyDocumentLanguage("en"); }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur-xl border-b hairline" style={{ background: "var(--header-bg)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Wordmark /> <span className="hidden sm:inline"><Tagline /></span>
          <span className="flex-1" />
          {profile && <span className="text-xs text-text-dim hidden sm:inline">{profile.full_name}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut().then(() => navigate("/login"))}><LogOut size={15} />{t("sign_out")}</button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-semibold">{t("rooms_title")}</h1>
          {isInternal && <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}><Plus size={14} />{t("create_room")}</button>}
        </div>
        {roomsLoading ? (
          <div className="grid sm:grid-cols-2 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : rooms.length === 0 ? (
          <EmptyState title={isInternal ? undefined : t("no_rooms_title")} body={isInternal ? t("rooms_empty") : t("no_rooms_body")} action={isInternal ? <button className="btn btn-primary btn-sm mt-2" onClick={() => setCreateOpen(true)}><Plus size={14} />{t("create_room")}</button> : undefined} />
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link to={`/r/${r.slug}`} className="panel p-4 flex items-center gap-3 hover:border-mint/30 transition-colors block">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-mint/10 text-mint"><DoorOpen size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-text-dim truncate">{r.client_name} · /r/{r.slug} · {fmtRelative(r.updated_at, lang)}</p>
                  </div>
                  <PhaseBadge phase={r.phase} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <CreateRoomModal open={createOpen} presetAccount={presetAccount} onClose={() => setCreateOpen(false)} onCreated={async (slug) => { await refreshRooms(); navigate(`/r/${slug}/settings`); }} />
    </div>
  );
}

function CreateRoomModal({ open, onClose, onCreated, presetAccount }: { open: boolean; onClose: () => void; onCreated: (slug: string) => Promise<void>; presetAccount?: string | null }) {
  const t = useT();
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [slug, setSlug] = useState("");
  const [language, setLanguage] = useState<Language>("he");
  const [welcome, setWelcome] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("accounts").select("id, name, short_name").eq("is_deleted", false).order("name").limit(500).then(({ data }) => {
      const rows = (data as AccountRow[]) ?? [];
      setAccounts(rows);
      if (presetAccount && rows.some((a) => a.id === presetAccount)) {
        const a = rows.find((x) => x.id === presetAccount)!;
        setAccountId(a.id);
        setClient(a.name);
        setName((n) => n || `${a.short_name || a.name} × ActiveApps`);
        setSlug((sl) => sl || slugify(a.short_name || a.name));
      }
    });
  }, [open, presetAccount]);

  const pickAccount = (id: string) => {
    setAccountId(id);
    const a = accounts.find((x) => x.id === id);
    if (a) {
      setClient(a.name);
      if (!name) setName(`${a.short_name || a.name} × ActiveApps`);
      if (!slug) setSlug(slugify(a.short_name || a.name));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("room_create", { p_name: name.trim(), p_client_name: client.trim(), p_slug: slug.trim(), p_language: language, p_account_id: accountId || null, p_welcome_message: welcome.trim() || null });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("saved"));
    onClose();
    await onCreated((data as { slug: string }).slug);
  };

  return (
    <Modal open={open} onClose={onClose} title={t("create_room")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("crm_account")} hint={accounts.length === 0 ? `— (${CRM_URL})` : undefined}>
          <select className="select" value={accountId} onChange={(e) => pickAccount(e.target.value)}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("client_name")}><input className="input" required value={client} onChange={(e) => setClient(e.target.value)} /></Field>
          <Field label={t("room_name")}><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("slug")} hint="rooms.activeapps.io/r/<slug>"><input className="input font-mono" required pattern="[a-z0-9][a-z0-9-]{1,62}" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} dir="ltr" /></Field>
          <Field label={t("language")}>
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="he">{t("lang_he")}</option>
              <option value="en">{t("lang_en")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("welcome_message")}><textarea className="textarea" value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder={t("welcome_placeholder")} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t("create_room")}</button>
        </div>
      </form>
    </Modal>
  );
}
