import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useRoom } from "../lib/room";
import { useT } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { Field, Modal } from "./ui";
import type { MemberRole } from "../lib/types";

export default function InviteMemberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { home, staffMode, refresh } = useRoom();
  const t = useT();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<MemberRole>("commenter");
  const [side, setSide] = useState<"client" | "activeapps">("client");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const clientRoles: MemberRole[] = staffMode ? ["owner", "approver", "commenter", "viewer"] : ["approver", "commenter", "viewer"];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("room_invite_member", {
      p_room_id: home.room.id,
      p_email: email.trim(),
      p_full_name: name.trim(),
      p_title: title.trim() || null,
      p_role: side === "activeapps" ? "member" : role,
      p_side: side,
      p_expires_at: expires ? new Date(expires).toISOString() : null,
    });
    if (error) {
      setBusy(false);
      toast.push("error", error.message);
      return;
    }
    // send the branded invitation (edge function; falls back gracefully if not deployed)
    const member = data as { id: string };
    const { error: fnErr } = await supabase.functions.invoke("room-invite", { body: { member_id: member.id } });
    setBusy(false);
    if (fnErr) toast.push("info", `${t("invite_sent", { email })} (e-mail pending: ${fnErr.message})`);
    else toast.push("success", t("invite_sent", { email }));
    setEmail(""); setName(""); setTitle(""); setExpires("");
    await refresh();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("invite_colleague")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("email")}>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoFocus />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("full_name")}>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={`${t("job_title")} (${t("optional")})`}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        {staffMode && (
          <Field label={t("team")}>
            <select className="select" value={side} onChange={(e) => setSide(e.target.value as "client" | "activeapps")}>
              <option value="client">{home.room.client_name}</option>
              <option value="activeapps">ActiveApps</option>
            </select>
          </Field>
        )}
        {side === "client" && (
          <Field label={t("role")}>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {clientRoles.map((r) => (
                <option key={r} value={r}>{t(`role_${r}` as "role_owner")}</option>
              ))}
            </select>
          </Field>
        )}
        {staffMode && (
          <Field label={`${t("expires_at")} (${t("optional")})`}>
            <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t("invite")}</button>
        </div>
      </form>
    </Modal>
  );
}
