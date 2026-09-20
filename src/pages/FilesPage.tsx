import { useEffect, useRef, useState } from "react";
import { FileText, Lock, Upload, Download, Eye, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtBytes, fmtRelative } from "../lib/format";
import { useToast } from "../lib/toast";
import { EmptyState } from "../components/ui";
import type { RoomDocument } from "../lib/types";

export default function FilesPage() {
  const { home, me, staffMode, refresh } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confidential, setConfidential] = useState(false);
  const [preview, setPreview] = useState<{ doc: RoomDocument; url: string } | null>(null);
  const files = home.documents.filter((d) => d.kind === "file");
  const ndaLocked = home.room.nda_required && !!me && !me.nda_accepted_at;

  useEffect(() => {
    // deep link: /files#<docId>
    const id = window.location.hash.slice(1);
    if (id) {
      const d = files.find((f) => f.id === id);
      if (d && !d.locked) void openPreview(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptNda = async () => {
    const { error } = await supabase.rpc("room_accept_nda", { p_room_id: home.room.id });
    if (error) toast.push("error", error.message);
    else { toast.push("success", t("nda_accepted")); await refresh(); }
  };

  const signedUrl = async (d: RoomDocument, download = false) => {
    if (!d.storage_path) return null;
    const { data, error } = await supabase.storage.from("room-files").createSignedUrl(d.storage_path, 300, download ? { download: d.file_name ?? true } : undefined);
    if (error) { toast.push("error", error.message); return null; }
    if (me) {
      void supabase.from("room_events").insert({ room_id: home.room.id, actor_member_id: me.id, type: download ? "file_downloaded" : "document_viewed", entity_type: "document", entity_id: d.id, payload: { title: d.title }, client_visible: false });
    }
    return data.signedUrl;
  };

  const openPreview = async (d: RoomDocument) => {
    const url = await signedUrl(d);
    if (!url) return;
    if (d.mime_type === "application/pdf" || d.mime_type?.startsWith("image/")) setPreview({ doc: d, url });
    else window.open(url, "_blank", "noopener");
  };

  const upload = async (file: File) => {
    if (!me) return;
    setUploading(true);
    const docId = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\-() ֐-׿]/g, "_");
    const path = `${home.room.id}/${docId}/${safeName}`;
    const { error: upErr } = await supabase.storage.from("room-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upErr) { setUploading(false); toast.push("error", upErr.message); return; }
    const { error } = await supabase.from("room_documents").insert({
      id: docId, room_id: home.room.id, kind: "file", title: file.name, status: "published", confidential,
      storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null, created_by: me.id,
    });
    if (!error) {
      await supabase.from("room_events").insert({ room_id: home.room.id, actor_member_id: me.id, type: "file_uploaded", entity_type: "document", entity_id: docId, payload: { title: file.name, confidential }, client_visible: !confidential });
    }
    setUploading(false);
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("saved"));
    await refresh();
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">{t("files_title")}</h1>
        {staffMode && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-dim flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />{t("confidential")}</label>
            <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.svg,.txt,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <button className="btn btn-primary btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={14} />{uploading ? t("uploading") : t("upload")}</button>
          </div>
        )}
      </div>

      {ndaLocked && files.some((f) => f.confidential) && (
        <div className="panel-elevated border-warning/30 p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <ShieldCheck size={20} className="text-warning shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t("nda_gate_title")}</p>
            <p className="text-sm text-text-mid">{t("nda_gate_body")}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={acceptNda}>{t("nda_accept")}</button>
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState body={t("files_empty")} />
      ) : (
        <ul className="panel divide-y divide-white/5">
          {files.map((d) => (
            <li key={d.id} id={d.id} className="px-4 py-3 flex items-center gap-3">
              {d.locked ? <Lock size={18} className="text-text-dim" /> : <FileText size={18} className="text-mint" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{d.title}</p>
                <p className="text-xs text-text-dim">{fmtBytes(d.file_size)}{d.file_size ? " · " : ""}{fmtRelative(d.updated_at, lang)}</p>
              </div>
              {d.confidential && <span className="badge badge-warning">{t("confidential")}</span>}
              {!d.locked && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => void openPreview(d)} title={t("preview")}><Eye size={14} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { const u = await signedUrl(d, true); if (u) window.location.href = u; }} title={t("download")}><Download size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between px-4 h-12 border-b hairline bg-navy">
            <span className="text-sm truncate">{preview.doc.title}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>{t("close")}</button>
          </div>
          {preview.doc.mime_type?.startsWith("image/") ? (
            <img src={preview.url} alt={preview.doc.title} className="flex-1 object-contain max-h-full" />
          ) : (
            <iframe src={preview.url} className="flex-1 w-full" title={preview.doc.title} />
          )}
        </div>
      )}
    </div>
  );
}
