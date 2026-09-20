import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Send, UserX, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useRoom } from "../../lib/room";
import { useT, useLang } from "../../lib/i18n";
import { fmtRelative, fmtDate } from "../../lib/format";
import { useToast } from "../../lib/toast";
import { Avatar, Field, Modal, RoleLabel, SectionTitle } from "../../components/ui";
import InviteMemberModal from "../../components/InviteMemberModal";
import type { EngagementStatus, Language, RoomTemplate } from "../../lib/types";

interface OppRow { id: string; name: string; stage: string }

export default function RoomSettingsPage() {
  const { home, staffMode, refresh } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const room = home.room;
  const [form, setForm] = useState({
    name: room.name, client_name: room.client_name, language: room.language as Language, welcome_message: room.welcome_message ?? "", welcome_video_url: room.welcome_video_url ?? "",
    nda_required: room.nda_required, response_sla_hours: room.response_sla_hours, status_note: room.status_note ?? "", next_milestone_label: room.next_milestone_label ?? "", next_milestone_date: room.next_milestone_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [engOpen, setEngOpen] = useState(false);

  useEffect(() => { if (!staffMode) navigate(`/r/${room.slug}`, { replace: true }); }, [staffMode, navigate, room.slug]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("rooms").update({
      ...form, welcome_message: form.welcome_message || null, welcome_video_url: form.welcome_video_url || null, status_note: form.status_note || null,
      next_milestone_label: form.next_milestone_label || null, next_milestone_date: form.next_milestone_date || null,
    }).eq("id", room.id);
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("saved"));
    await refresh();
  };

  const uploadLogo = async (file: File) => {
    const path = `${room.id}/logo/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("room-files").upload(path, file, { contentType: file.type });
    if (error) { toast.push("error", error.message); return; }
    await supabase.from("rooms").update({ client_logo_path: path }).eq("id", room.id);
    await refresh();
  };

  const revoke = async (id: string) => {
    if (!window.confirm(t("revoke") + "?")) return;
    const { error } = await supabase.from("room_members").update({ status: "revoked" }).eq("id", id);
    if (error) toast.push("error", error.message);
    await refresh();
  };

  const resend = async (id: string, email: string) => {
    const { error } = await supabase.functions.invoke("room-invite", { body: { member_id: id } });
    if (error) toast.push("error", error.message); else toast.push("success", t("invite_sent", { email }));
  };

  const setEngStatus = async (id: string, status: EngagementStatus) => {
    const { error } = await supabase.from("room_engagements").update({ status }).eq("id", id);
    if (error) toast.push("error", error.message);
    await refresh();
  };
  const setEngField = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from("room_engagements").update(patch).eq("id", id);
    if (error) toast.push("error", error.message);
    await refresh();
  };

  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-lg font-semibold">{t("room_settings")}</h1>

      <form onSubmit={save} className="panel p-5 flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("room_name")}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("client_name")}><input className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
          <Field label={t("language")}>
            <select className="select" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language })}><option value="he">{t("lang_he")}</option><option value="en">{t("lang_en")}</option></select>
          </Field>
          <Field label={t("response_sla")}><input className="input" type="number" min={1} value={form.response_sla_hours} onChange={(e) => setForm({ ...form, response_sla_hours: Number(e.target.value) })} dir="ltr" /></Field>
        </div>
        <Field label={t("welcome_message")}><textarea className="textarea" value={form.welcome_message} onChange={(e) => setForm({ ...form, welcome_message: e.target.value })} placeholder={t("welcome_placeholder")} /></Field>
        <Field label="Welcome video URL (embed)"><input className="input" value={form.welcome_video_url} onChange={(e) => setForm({ ...form, welcome_video_url: e.target.value })} dir="ltr" /></Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={t("status_note")}><input className="input" value={form.status_note} onChange={(e) => setForm({ ...form, status_note: e.target.value })} /></Field>
          <Field label={t("next_milestone_label")}><input className="input" value={form.next_milestone_label} onChange={(e) => setForm({ ...form, next_milestone_label: e.target.value })} /></Field>
          <Field label={t("next_milestone_date")}><input className="input" type="date" value={form.next_milestone_date} onChange={(e) => setForm({ ...form, next_milestone_date: e.target.value })} /></Field>
        </div>
        <label className="text-sm flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.nda_required} onChange={(e) => setForm({ ...form, nda_required: e.target.checked })} />{t("nda_required")}</label>
        <div className="flex items-center gap-3">
          <label className="btn btn-secondary btn-sm cursor-pointer"><Upload size={14} />Logo<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} /></label>
          <span className="text-xs text-text-dim font-mono" dir="ltr">{room.client_logo_path ?? "—"}</span>
          <span className="flex-1" />
          <button type="submit" className="btn btn-primary" disabled={busy}>{t("save")}</button>
        </div>
      </form>

      <section>
        <SectionTitle action={<button className="btn btn-primary btn-sm" onClick={() => setEngOpen(true)}><Plus size={14} />{t("new_engagement")}</button>}>{t("nav_engagement")}s</SectionTitle>
        <ul className="panel divide-y divide-white/5">
          {home.engagements.map((e) => (
            <li key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{e.name}</p>
                <p className="text-xs text-text-dim">{e.type} · {e.currency}{e.opportunity_id ? ` · opp ${e.opportunity_id.slice(0, 8)}` : ""}{e.agreed_at ? ` · ${t("status_agreed")} ${fmtDate(e.agreed_at, lang)}` : ""}</p>
              </div>
              <select className="select !w-auto !py-1 text-xs" value={e.status} onChange={(ev) => setEngStatus(e.id, ev.target.value as EngagementStatus)}>
                {(["draft", "shared", "agreed", "signed", "active", "completed", "cancelled"] as EngagementStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="text-xs text-text-dim flex items-center gap-1">{t("set_offer_valid_until")}<input className="input !w-auto !py-1 text-xs" type="date" value={e.offer_valid_until ?? ""} onChange={(ev) => setEngField(e.id, { offer_valid_until: ev.target.value || null })} /></label>
              <label className="text-xs text-text-dim flex items-center gap-1">{t("kickoff")}<input className="input !w-auto !py-1 text-xs" type="date" value={e.kickoff_date ?? ""} onChange={(ev) => setEngField(e.id, { kickoff_date: ev.target.value || null })} /></label>
            </li>
          ))}
          {home.engagements.length === 0 && <li className="px-4 py-3 text-sm text-text-dim">—</li>}
        </ul>
      </section>

      <section>
        <SectionTitle action={<button className="btn btn-secondary btn-sm" onClick={() => setInviteOpen(true)}><Plus size={14} />{t("invite")}</button>}>{t("members_title")}</SectionTitle>
        <ul className="panel divide-y divide-white/5">
          {home.members.map((m) => (
            <li key={m.id} className="px-4 py-2.5 flex items-center gap-3">
              <Avatar name={m.full_name} email={m.email} side={m.side} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{m.full_name || m.email} <span className="text-text-faint text-xs">· {m.email}</span></p>
                <p className="text-xs text-text-dim"><RoleLabel role={m.role} /> · {m.status}{m.last_seen_at ? ` · ${t("last_seen", { when: fmtRelative(m.last_seen_at, lang) })}` : ""}{m.expires_at ? ` · ${t("expires_at")} ${fmtDate(m.expires_at, lang)}` : ""}</p>
              </div>
              {m.side === "client" && <button className="btn btn-ghost btn-sm" onClick={() => resend(m.id, m.email)} title={t("resend_invite")}><Send size={14} /></button>}
              {m.side === "client" && <button className="btn btn-ghost btn-sm text-destructive" onClick={() => revoke(m.id)} title={t("revoke")}><UserX size={14} /></button>}
            </li>
          ))}
        </ul>
      </section>

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <NewEngagementModal open={engOpen} onClose={() => setEngOpen(false)} />
    </div>
  );
}

function NewEngagementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { home, refresh } = useRoom();
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<RoomTemplate[]>([]);
  const [opps, setOpps] = useState<OppRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [oppId, setOppId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    supabase.from("room_templates").select("id, name, engagement_type, language").order("name").then(({ data }) => setTemplates((data as RoomTemplate[]) ?? []));
    if (home.room.account_id) supabase.from("opportunities").select("id, name, stage").eq("account_id", home.room.account_id).eq("is_deleted", false).then(({ data }) => setOpps((data as OppRow[]) ?? []));
  }, [open, home.room.account_id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("room_create_engagement_from_template", { p_room_id: home.room.id, p_template_id: templateId, p_name: name.trim() || null, p_opportunity_id: oppId || null });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    onClose();
    await refresh();
    const r = data as { document_id: string };
    navigate(`/r/${home.room.slug}/doc/${r.document_id}`);
  };
  return (
    <Modal open={open} onClose={onClose} title={t("new_engagement")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("from_template")}>
          <select className="select" required value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">—</option>
            {templates.filter((x) => x.language === home.room.language).concat(templates.filter((x) => x.language !== home.room.language)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label={`${t("engagement_name")} (${t("optional")})`}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {opps.length > 0 && (
          <Field label={t("crm_opportunity")}>
            <select className="select" value={oppId} onChange={(e) => setOppId(e.target.value)}>
              <option value="">—</option>
              {opps.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.stage})</option>)}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !templateId}>{t("add")}</button>
        </div>
      </form>
    </Modal>
  );
}
