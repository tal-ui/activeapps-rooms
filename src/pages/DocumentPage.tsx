import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer, Pencil, Eye, Send, GitCompare, ShieldCheck, MessageSquare } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom, canApprove } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtDate, fmtDateTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { BlockRenderer } from "../components/blocks/BlockRenderer";
import BlockPanel from "../components/BlockPanel";
import BlockEditor from "../components/BlockEditor";
import { Field, Modal, Skeleton, StatusBadge, Wordmark } from "../components/ui";
import type { DocumentView, SowReadiness, ViewBlock } from "../lib/types";

export default function DocumentPage() {
  const { docId } = useParams();
  const [params, setParams] = useSearchParams();
  const { home, me, staffMode, refresh } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [view, setView] = useState<DocumentView | null>(null);
  const [version, setVersion] = useState<number | null>(null); // null = latest (clients) / 0 working copy (staff)
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [showDiff, setShowDiff] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.get("block"));
  const [publishOpen, setPublishOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(params.get("approve") === "1");
  const [readiness, setReadiness] = useState<SowReadiness | null>(null);
  const [printing, setPrinting] = useState(false);
  const engagement = useMemo(() => home.engagements.find((e) => e.id === view?.document.engagement_id) ?? null, [home.engagements, view?.document.engagement_id]);

  const load = useCallback(async () => {
    if (!docId) return;
    const v = version === null ? (staffMode ? 0 : null) : version;
    const { data, error } = await supabase.rpc("room_document_view", { p_document_id: docId, p_version: v });
    if (error) { toast.push("error", error.message); return; }
    setView(data as DocumentView);
    if (engagement) {
      const r = await supabase.rpc("room_sow_readiness", { p_engagement_id: engagement.id });
      setReadiness((r.data as SowReadiness) ?? null);
    }
  }, [docId, version, staffMode, toast, engagement]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (staffMode && version === null) setMode("edit"); }, [staffMode, version]);

  // log the document view once
  useEffect(() => {
    if (!view || !me) return;
    void supabase.from("room_events").insert({ room_id: home.room.id, actor_member_id: me.id, type: "document_viewed", entity_type: "document", entity_id: view.document.id, payload: { title: view.document.title, version: view.version }, client_visible: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.document.id, me?.id]);

  // block dwell tracking (≥ 2s in viewport) — published versions, client members only
  const dwell = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!view || !me || me.side !== "client" || view.version === 0 || mode === "edit") return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-block-id]"));
    const starts = new Map<string, number>();
    const flush = async (id: string) => {
      const s = starts.get(id);
      if (!s) return;
      const ms = Date.now() - s;
      starts.delete(id);
      if (ms < 2000) return;
      dwell.current.set(id, (dwell.current.get(id) ?? 0) + ms);
      await supabase.from("room_block_views").upsert({ room_id: home.room.id, member_id: me.id, block_id: id, dwell_ms: dwell.current.get(id) ?? ms, last_seen_at: new Date().toISOString() }, { onConflict: "member_id,block_id" });
    };
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const id = (en.target as HTMLElement).dataset.blockId!;
        if (en.isIntersecting && en.intersectionRatio >= 0.5) starts.set(id, Date.now());
        else void flush(id);
      }
    }, { threshold: [0.5] });
    els.forEach((el) => io.observe(el));
    const onHide = () => { for (const id of Array.from(starts.keys())) void flush(id); };
    document.addEventListener("visibilitychange", onHide);
    return () => { io.disconnect(); onHide(); document.removeEventListener("visibilitychange", onHide); };
  }, [view, me, mode, home.room.id]);

  useEffect(() => {
    const b = params.get("block");
    if (b) {
      setSelected(b);
      window.setTimeout(() => document.querySelector(`[data-block-id="${b}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }, [params]);

  const selectBlock = (id: string) => {
    setSelected(id);
    params.set("block", id);
    setParams(params, { replace: true });
  };

  const selectPricing = async (blockId: string) => {
    if (!engagement) return;
    const { error } = await supabase.rpc("room_select_pricing_option", { p_engagement_id: engagement.id, p_block_id: blockId });
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("selected_option"));
    await refresh();
  };

  const approveSow = async () => {
    if (!engagement) return;
    const { error } = await supabase.rpc("room_approve_sow", { p_engagement_id: engagement.id, p_user_agent: navigator.userAgent });
    if (error) { toast.push("error", error.message); return; }
    setApproveOpen(false);
    toast.push("success", t("status_agreed"));
    await refresh();
    await load();
  };

  const publish = async (summary: string) => {
    if (!docId) return;
    const { data, error } = await supabase.rpc("room_publish_version", { p_document_id: docId, p_change_summary: summary || null });
    if (error) { toast.push("error", error.message); return; }
    const r = data as { version: number; change_summary: string };
    toast.push("success", `${t("published")} v${r.version} — ${r.change_summary}`);
    setPublishOpen(false);
    await refresh();
    await load();
  };

  const print = () => {
    setPrinting(true);
    window.setTimeout(() => { window.print(); setPrinting(false); }, 150);
  };

  if (!view) {
    return <div className="max-w-3xl mx-auto flex flex-col gap-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  }

  const selectedBlock = view.blocks.find((b) => b.id === selected) ?? null;
  const published = view.versions;
  const latest = published[0]?.version ?? 0;
  const isWorking = view.version === 0;
  const canApproveSow = canApprove(me) && engagement?.status === "shared" && view.document.kind === "sow";
  const pricingSelectable = canApprove(me) && engagement?.status === "shared";

  return (
    <div className={printing ? "print-mode" : ""}>
      {/* ---- header ---- */}
      <div className="print:hidden flex flex-wrap items-center gap-2 mb-4">
        <Link to={`/r/${home.room.slug}`} className="btn btn-ghost btn-sm"><ArrowLeft size={14} className="rtl:rotate-180" />{t("back")}</Link>
        <h1 className="text-lg font-semibold truncate flex-1 min-w-[10rem]">{view.document.title}</h1>
        {view.document.status === "draft" && <StatusBadge status="draft" />}
        {/* version selector */}
        {(published.length > 0 || staffMode) && (
          <select className="select !w-auto !py-1.5 text-xs" value={view.version} onChange={(e) => { const v = Number(e.target.value); setVersion(v); setShowDiff(false); setMode(v === 0 ? "edit" : "view"); }}>
            {staffMode && <option value={0}>{t("working_copy")}</option>}
            {published.map((v) => <option key={v.id} value={v.version}>{t("version_n", { n: v.version })} · {fmtDate(v.published_at, lang)}</option>)}
          </select>
        )}
        {view.version > 1 && (
          <button className={`btn btn-sm ${showDiff ? "btn-secondary" : "btn-ghost"}`} onClick={() => setShowDiff((v) => !v)}><GitCompare size={14} />{showDiff ? t("hide_changes") : t("show_changes_since", { n: view.version - 1 })}</button>
        )}
        {view.version > 0 && <button className="btn btn-ghost btn-sm" onClick={print}><Printer size={14} />{t("export_pdf")}</button>}
        {staffMode && isWorking && (
          <>
            <button className={`btn btn-sm ${mode === "edit" ? "btn-secondary" : "btn-ghost"}`} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>{mode === "edit" ? <><Eye size={14} />{t("preview_as_client")}</> : <><Pencil size={14} />{t("edit")}</>}</button>
            <button className="btn btn-primary btn-sm" onClick={() => setPublishOpen(true)}><Send size={14} />{t("publish_version")}</button>
          </>
        )}
      </div>

      {/* ---- change summary of this version ---- */}
      {!isWorking && published.find((v) => v.version === view.version)?.change_summary && view.version > 1 && (
        <p className="print:hidden text-xs text-text-dim mb-3 flex items-center gap-2"><GitCompare size={12} />{published.find((v) => v.version === view.version)?.change_summary}</p>
      )}

      {/* ---- approve SOW bar ---- */}
      {canApproveSow && readiness && (
        <div className={`print:hidden panel-elevated p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 ${readiness.ready ? "border-mint/40 glow-mint" : ""}`}>
          <ShieldCheck size={20} className={readiness.ready ? "text-mint" : "text-text-dim"} />
          <div className="flex-1 text-sm">
            {readiness.ready ? t("approve_sow_ready", { total: readiness.total }) : t("approve_sow_hint", { pending: readiness.pending, total: readiness.total })}
            <p className="text-xs text-text-faint mt-0.5">{t("approval_disclaimer")}</p>
          </div>
          <button className="btn btn-primary" disabled={!readiness.ready} onClick={() => setApproveOpen(true)}>{t("approve_sow")}</button>
        </div>
      )}
      {engagement?.status === "agreed" && engagement.agreement_record && (
        <div className="print:hidden text-xs text-mint mb-4 inline-flex items-center gap-1.5"><ShieldCheck size={13} />{t("sow_approved_banner", { name: String(engagement.agreement_record.full_name ?? ""), when: fmtDateTime(String(engagement.agreement_record.approved_at ?? ""), lang), version: String(engagement.agreement_record.version ?? "") })}</div>
      )}

      <div className="grid lg:grid-cols-[1fr_22rem] gap-6 items-start">
        {/* ---- document body ---- */}
        <div className="doc-surface px-5 py-6 sm:px-10 sm:py-10 print:border-0 print:p-0 min-w-0">
          <div className="hidden print:block mb-8">
            <Wordmark />
            <p className="text-2xl font-bold mt-4">{view.document.title}</p>
            <p className="text-sm">{home.room.client_name} · v{view.version} · {fmtDate(published.find((v) => v.version === view.version)?.published_at ?? new Date().toISOString(), lang)}</p>
          </div>
          <div className="doc-body">
            {mode === "edit" && isWorking && staffMode ? (
              <BlockEditor documentId={view.document.id} onChanged={load} />
            ) : (
              <>
                {view.blocks.length === 0 && <p className="text-text-dim text-sm">{t("documents_empty")}</p>}
                {view.blocks.map((b) => (
                  <BlockRenderer
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onSelect={selectBlock}
                    showDiff={showDiff}
                    selectedPricingId={engagement?.selected_pricing_option_block_id}
                    onSelectPricing={selectPricing}
                    canSelectPricing={!!pricingSelectable}
                    currency={engagement?.currency}
                    plain={printing}
                  />
                ))}
                {showDiff && view.removed_since_previous.length > 0 && (
                  <div className="mt-6">
                    <p className="label-mono mb-2">{t("removed_in_version")}</p>
                    {view.removed_since_previous.map((b) => (
                      <div key={b.id} className="block is-removed"><BlockRenderer block={{ ...b, display_status: b.status, live_status: b.status, comment_count: 0, open_question_count: 0, diff: null, is_new_since_visit: false } as ViewBlock} plain /></div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- side panel (desktop) ---- */}
        {mode !== "edit" && (
          <aside className="print:hidden hidden lg:block sticky top-20 panel-elevated h-[calc(100vh-6.5rem)] overflow-hidden">
            {selectedBlock || selected === "doc" ? (
              <BlockPanel documentId={view.document.id} block={selectedBlock} onClose={() => setSelected(null)} onChanged={load} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3 text-text-dim">
                <MessageSquare size={22} />
                <p className="text-sm">{t("block_panel_empty")}</p>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected("doc")}>{t("comments")} · {t("documents")}</button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ---- side panel (mobile bottom sheet) ---- */}
      {mode !== "edit" && (selectedBlock || selected === "doc") && (
        <div className="print:hidden lg:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelected(null)} />
          <div className="relative w-full max-h-[85vh] panel-elevated rounded-b-none animate-slide-in flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <BlockPanel documentId={view.document.id} block={selectedBlock} onClose={() => setSelected(null)} onChanged={load} />
          </div>
        </div>
      )}
      {mode !== "edit" && !selectedBlock && selected !== "doc" && (
        <button className="print:hidden lg:hidden fixed bottom-[4.5rem] end-4 z-30 btn btn-secondary shadow-lg" onClick={() => setSelected("doc")}><MessageSquare size={16} />{t("comments")}</button>
      )}

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} onPublish={publish} nextVersion={latest + 1} />

      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title={t("approve_sow")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-light">{readiness ? t("approve_sow_ready", { total: readiness.total }) : ""}</p>
          <ul className="text-sm text-text-mid list-disc ps-5">
            <li>{me?.full_name} · {me?.email}</li>
            <li>{view.document.title} · v{latest}</li>
            <li>{fmtDateTime(new Date().toISOString(), lang)}</li>
          </ul>
          <p className="text-xs text-text-faint">{t("approval_disclaimer")}</p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setApproveOpen(false)}>{t("cancel")}</button>
            <button className="btn btn-primary" disabled={!readiness?.ready} onClick={approveSow}><ShieldCheck size={16} />{t("approve_sow_confirm")}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PublishModal({ open, onClose, onPublish, nextVersion }: { open: boolean; onClose: () => void; onPublish: (summary: string) => Promise<void>; nextVersion: number }) {
  const t = useT();
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={`${t("publish_version")} · v${nextVersion}`}>
      <div className="flex flex-col gap-4">
        <Field label={t("change_summary")} hint={t("change_summary_auto")}>
          <textarea className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onPublish(summary); setBusy(false); setSummary(""); }}><Send size={14} />{t("publish_version")}</button>
        </div>
      </div>
    </Modal>
  );
}
