import { useEffect, useState } from "react";
import { Check, Star, Paperclip, AlertTriangle, Info, CheckCircle2, MessageSquare, MessageCircleQuestion } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { fmtDate, fmtMoney } from "../../lib/format";
import { useT, useLang } from "../../lib/i18n";
import { supabase } from "../../lib/supabase";
import { StatusBadge } from "../ui";
import type { ViewBlock, DeliverableContent, AssumptionContent, MilestoneContent, PricingOptionContent, PricingLineContent, TableContent, CalloutContent, HeadingContent, TextContent, FileContent, ImageContent } from "../../lib/types";

export interface BlockRendererProps {
  block: ViewBlock;
  selected?: boolean;
  onSelect?: (id: string) => void;
  showDiff?: boolean;
  /** pricing option selection */
  selectedPricingId?: string | null;
  onSelectPricing?: (blockId: string) => void;
  canSelectPricing?: boolean;
  currency?: string;
  /** hide status chrome (used for PDF/print) */
  plain?: boolean;
}

const APPROVABLE = new Set(["deliverable", "assumption", "milestone", "pricing_line", "table"]);

export function BlockRenderer(props: BlockRendererProps) {
  const { block, selected, onSelect, showDiff, plain } = props;
  const t = useT();
  const c = block.content;
  const diffCls = showDiff && block.diff === "added" ? "is-new" : showDiff && block.diff === "changed" ? "is-changed" : block.is_new_since_visit ? "is-new" : "";
  const isStructural = block.type === "heading" || block.type === "divider";

  if (block.type === "divider") return <hr className="border-white/8 my-4" />;

  const body = (() => {
    switch (block.type) {
      case "heading": {
        const h = c as unknown as HeadingContent;
        const cls = h.level === 1 ? "text-2xl sm:text-3xl font-bold mt-2" : h.level === 3 ? "text-base font-semibold mt-4" : "text-xl font-semibold mt-6";
        return <h2 className={`${cls} text-foreground`}>{h.text}</h2>;
      }
      case "text":
        return <div className="prose-room" dangerouslySetInnerHTML={{ __html: renderMarkdown((c as unknown as TextContent).markdown) }} />;
      case "callout": {
        const co = c as unknown as CalloutContent;
        const tone = co.tone === "warning" ? { cls: "border-warning/30 bg-warning/8", Icon: AlertTriangle, ic: "text-warning" } : co.tone === "success" ? { cls: "border-mint/30 bg-mint/8", Icon: CheckCircle2, ic: "text-mint" } : { cls: "border-info/30 bg-info/8", Icon: Info, ic: "text-info" };
        return (
          <div className={`rounded-lg border px-4 py-3 flex gap-3 ${tone.cls}`}>
            <tone.Icon size={16} className={`${tone.ic} mt-1 shrink-0`} />
            <div className="prose-room prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(co.markdown) }} />
          </div>
        );
      }
      case "deliverable": {
        const d = c as unknown as DeliverableContent;
        return (
          <div>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-foreground text-base">{d.title}</h3>
              <div className="flex items-center gap-1.5 shrink-0">
                {d.phase && <span className="badge">{d.phase}</span>}
                {d.owner_side && <span className={`badge ${d.owner_side === "client" ? "badge-info" : "badge-mint"}`}>{d.owner_side === "client" ? t("side_client", { client: "" }).trim() || "Client" : "ActiveApps"}</span>}
              </div>
            </div>
            {d.description && <div className="prose-room prose-sm mt-1" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.description) }} />}
            {d.acceptance_criteria && d.acceptance_criteria.length > 0 && (
              <div className="mt-3">
                <p className="label-mono mb-1.5">{t("acceptance_criteria")}</p>
                <ul className="flex flex-col gap-1">
                  {d.acceptance_criteria.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-light"><Check size={14} className="text-mint mt-1 shrink-0" />{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }
      case "assumption": {
        const a = c as unknown as AssumptionContent;
        return (
          <div className="flex gap-3">
            <span className="w-1 rounded bg-info/60 shrink-0" />
            <div>
              <p className="text-sm text-text-light">{a.text}</p>
              {a.impact_if_false && <p className="text-xs text-text-dim mt-1"><span className="label-mono">{t("impact_if_false")}:</span> {a.impact_if_false}</p>}
            </div>
          </div>
        );
      }
      case "milestone": {
        const m = c as unknown as MilestoneContent;
        const lang = useLang();
        const st = m.status ?? "planned";
        return (
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full shrink-0 ${st === "done" ? "bg-mint" : st === "in_progress" ? "bg-warning" : "border-2 border-white/25"}`} />
            <span className="flex-1 text-sm font-medium text-foreground">{m.title}</span>
            <span className="text-xs text-text-dim font-mono">{m.target_date ? fmtDate(m.target_date, lang) : "—"}</span>
            <span className="badge">{t(st === "done" ? "milestone_done" : st === "in_progress" ? "milestone_in_progress" : "milestone_planned")}</span>
          </div>
        );
      }
      case "pricing_option": {
        const p = c as unknown as PricingOptionContent;
        const lang = useLang();
        const isSel = props.selectedPricingId === block.id;
        return (
          <div className={`rounded-lg border p-4 sm:p-5 transition-colors ${isSel ? "border-mint/50 bg-mint/5 glow-mint" : "border-white/8 bg-navy-light/40"}`} id="pricing">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground text-base flex items-center gap-2">{p.name}{p.recommended && <span className="badge badge-mint"><Star size={10} />{t("recommended")}</span>}</h3>
                {p.description && <p className="text-sm text-text-mid mt-0.5">{p.description}</p>}
              </div>
              <div className="text-end shrink-0">
                <p className="text-xl font-heading font-bold text-foreground" dir="ltr">{p.price ? fmtMoney(p.price, p.currency || props.currency || "ILS", lang) : "—"}</p>
                <p className="text-xs text-text-dim">{t(p.billing === "monthly" ? "billing_monthly" : p.billing === "hourly" ? "billing_hourly" : "billing_one_time")}</p>
              </div>
            </div>
            {p.includes && p.includes.length > 0 && (
              <ul className="mt-3 grid sm:grid-cols-2 gap-1">
                {p.includes.map((i, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-text-light"><Check size={14} className="text-mint mt-1 shrink-0" />{i}</li>
                ))}
              </ul>
            )}
            {!plain && (props.canSelectPricing || isSel) && (
              <div className="mt-4">
                {isSel ? (
                  <span className="btn btn-secondary btn-sm !cursor-default text-mint"><Check size={14} />{t("selected_option")}</span>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); props.onSelectPricing?.(block.id); }}>{t("select_option")}</button>
                )}
              </div>
            )}
          </div>
        );
      }
      case "pricing_line": {
        const l = c as unknown as PricingLineContent;
        const lang = useLang();
        const total = l.total ?? l.quantity * l.unit_price;
        return (
          <div className="flex items-center gap-3 text-sm">
            <span className="flex-1 text-text-light">{l.label}</span>
            <span className="text-text-dim font-mono text-xs" dir="ltr">{l.quantity} × {fmtMoney(l.unit_price, l.currency || props.currency || "ILS", lang)}</span>
            <span className="font-medium text-foreground font-mono" dir="ltr">{fmtMoney(total, l.currency || props.currency || "ILS", lang)}</span>
          </div>
        );
      }
      case "table": {
        const tb = c as unknown as TableContent;
        return (
          <div className="overflow-x-auto rounded-lg border border-white/8">
            <table className="w-full text-sm">
              <thead className="bg-navy-light/60">
                <tr>{(tb.columns ?? []).map((col, i) => <th key={i} className="text-start px-3 py-2 label-mono !text-text-dim font-medium">{col}</th>)}</tr>
              </thead>
              <tbody>
                {(tb.rows ?? []).map((row, r) => (
                  <tr key={r} className="border-t border-white/5">{row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-text-light">{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "file": {
        const f = c as unknown as FileContent;
        return <SignedFileLink path={f.storage_path} label={f.caption || f.file_name || f.storage_path} />;
      }
      case "image": {
        const im = c as unknown as ImageContent;
        return <SignedImage path={im.storage_path} alt={im.alt || im.caption || ""} caption={im.caption} />;
      }
      default:
        return <pre className="text-xs text-text-dim">{JSON.stringify(c)}</pre>;
    }
  })();

  if (plain) return <div className="py-2">{body}</div>;

  const approvable = APPROVABLE.has(block.type);
  return (
    <div
      className={`block ${selected ? "is-selected" : ""} ${diffCls}`}
      onClick={() => !isStructural && onSelect?.(block.id)}
      role={isStructural ? undefined : "button"}
      tabIndex={isStructural ? -1 : 0}
      onKeyDown={(e) => { if (!isStructural && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect?.(block.id); } }}
      data-block-id={block.id}
    >
      {body}
      {!isStructural && (
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          {approvable && <StatusBadge status={block.display_status} />}
          {showDiff && block.diff === "added" && <span className="badge badge-mint">{t("added_in_version")}</span>}
          {showDiff && block.diff === "changed" && <span className="badge badge-warning">{t("changed_in_version")}</span>}
          {!showDiff && block.is_new_since_visit && <span className="badge badge-mint">{t("new_since_visit")}</span>}
          <span className="flex-1" />
          {block.comment_count > 0 && <span className="inline-flex items-center gap-1 text-xs text-text-dim"><MessageSquare size={12} />{block.comment_count}</span>}
          {block.open_question_count > 0 && <span className="inline-flex items-center gap-1 text-xs text-warning"><MessageCircleQuestion size={12} />{block.open_question_count}</span>}
        </div>
      )}
    </div>
  );
}

function SignedFileLink({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("room-files").createSignedUrl(path, 300).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [path]);
  return (
    <a href={url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-mint hover:underline" onClick={(e) => e.stopPropagation()}>
      <Paperclip size={14} />{label}
    </a>
  );
}

function SignedImage({ path, alt, caption }: { path: string; alt: string; caption?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("room-files").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [path]);
  return (
    <figure>
      {url ? <img src={url} alt={alt} className="rounded-lg border border-white/8 max-h-[28rem] object-contain" /> : <div className="skeleton h-40" />}
      {caption && <figcaption className="text-xs text-text-dim mt-1.5">{caption}</figcaption>}
    </figure>
  );
}
