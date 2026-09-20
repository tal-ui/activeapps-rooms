import type { Language } from "./types";
import { translate } from "./i18n";

const locale = (lang: Language) => (lang === "he" ? "he-IL" : "en-GB");

export function fmtDate(value: string | null | undefined, lang: Language, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale(lang), opts ?? { day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function fmtDateTime(value: string | null | undefined, lang: Language): string {
  return fmtDate(value, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(value: string | null | undefined, lang: Language): string {
  if (!value) return "—";
  const d = new Date(value).getTime();
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return translate(lang, "just_now");
  if (min < 60) return translate(lang, "minutes_ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return translate(lang, "hours_ago", { n: h });
  const days = Math.round(h / 24);
  if (days === 1) return translate(lang, "yesterday");
  if (days < 14) return translate(lang, "days_ago", { n: days });
  return fmtDate(value, lang);
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export function fmtMoney(amount: number | string | null | undefined, currency = "ILS", lang: Language = "en"): string {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(locale(lang), { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name && name.trim()) || email || "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function blockTitle(type: string, content: Record<string, unknown>): string {
  const c = content as Record<string, string | undefined>;
  switch (type) {
    case "heading": return c.text ?? "";
    case "text": return (c.markdown ?? "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 80);
    case "callout": return (c.markdown ?? "").slice(0, 80);
    case "deliverable": case "milestone": return c.title ?? "";
    case "assumption": return c.text ?? "";
    case "pricing_option": return c.name ?? "";
    case "pricing_line": return c.label ?? "";
    case "file": case "image": return c.caption ?? c.file_name ?? "";
    case "table": return `${(content.columns as string[] | undefined)?.length ?? 0} columns`;
    default: return "";
  }
}
