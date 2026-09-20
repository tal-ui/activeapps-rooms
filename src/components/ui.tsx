import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { useT } from "../lib/i18n";
import { initials } from "../lib/format";
import type { BlockStatus, MemberRole, RoomPhase } from "../lib/types";

export function Spinner({ size = 20 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-mint" aria-label="loading" />;
}

export function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Spinner size={28} />
    </div>
  );
}

export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={`font-heading font-bold tracking-tight ${cls}`} dir="ltr">
      <span className="text-text-light">ACTIVE</span>
      <span className="text-mint">APPS</span>
    </span>
  );
}

export function Tagline() {
  return <span className="label-mono" style={{ color: "#5E6268" }} dir="ltr">Tech Orchestration</span>;
}

export function NotFound() {
  const t = useT();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
      <Wordmark size="lg" />
      <p className="text-text-mid">{t("not_found")}</p>
      <Link to="/" className="btn btn-secondary">{t("back")}</Link>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="panel px-4 py-3 flex items-start gap-3 text-sm border-destructive/40">
      <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
      <span className="text-text-light">{message}</span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function Avatar({ name, email, side, size = 32 }: { name?: string | null; email?: string | null; side?: "activeapps" | "client"; size?: number }) {
  const mint = side === "activeapps";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-mono font-semibold shrink-0 select-none ${mint ? "bg-mint/15 text-mint border border-mint/25" : "bg-navy-surface text-text-light border border-white/8"}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
      title={name ?? email ?? ""}
      dir="ltr"
    >
      {initials(name, email)}
    </span>
  );
}

export function StatusBadge({ status }: { status: BlockStatus }) {
  const t = useT();
  const map: Record<BlockStatus, { cls: string; key: "status_draft" | "status_in_review" | "status_agreed" | "status_changed" }> = {
    draft: { cls: "", key: "status_draft" },
    in_review: { cls: "badge-info", key: "status_in_review" },
    agreed: { cls: "badge-mint", key: "status_agreed" },
    changed: { cls: "badge-warning", key: "status_changed" },
  };
  const m = map[status] ?? map.in_review;
  return <span className={`badge ${m.cls}`}>{t(m.key)}</span>;
}

export function PhaseBadge({ phase }: { phase: RoomPhase }) {
  const t = useT();
  const key = (`phase_${phase}`) as "phase_prospect" | "phase_active" | "phase_retainer" | "phase_dormant" | "phase_closed";
  const cls = phase === "active" || phase === "retainer" ? "badge-mint" : phase === "prospect" ? "badge-info" : "";
  return (
    <span className={`badge ${cls}`}>
      {(phase === "active" || phase === "prospect") && <span className="pulse-dot" />}
      {t(key)}
    </span>
  );
}

export function RoleLabel({ role }: { role: MemberRole }) {
  const t = useT();
  const key = (`role_${role}`) as "role_owner" | "role_approver" | "role_commenter" | "role_viewer" | "role_admin" | "role_member";
  return <span className="text-text-dim text-xs">{t(key)}</span>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="label-mono !text-text-dim">{children}</h2>
      {action}
    </div>
  );
}

export function DiamondDivider() {
  return (
    <div className="diamond-divider my-8" aria-hidden="true">
      <span />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title?: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center flex flex-col items-center gap-2">
      {title && <h3 className="text-text-light font-semibold">{title}</h3>}
      <p className="text-text-dim text-sm max-w-sm">{body}</p>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} panel-elevated rounded-b-none sm:rounded-xl max-h-[92vh] overflow-y-auto animate-slide-in`}>
        <div className="sticky top-0 bg-navy-light/95 backdrop-blur px-5 py-3.5 border-b hairline flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-mono block mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-text-faint">{hint}</span>}
    </label>
  );
}
