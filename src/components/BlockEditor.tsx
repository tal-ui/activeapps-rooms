import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Copy, Trash2, Plus, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom } from "../lib/room";
import { useT } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { blockTitle } from "../lib/format";
import { StatusBadge, Field } from "./ui";
import type { Block, BlockType } from "../lib/types";

const TYPES: BlockType[] = ["heading", "text", "callout", "deliverable", "assumption", "milestone", "pricing_option", "pricing_line", "table", "file", "image", "divider"];

const DEFAULTS: Record<BlockType, Record<string, unknown>> = {
  heading: { text: "", level: 2 },
  text: { markdown: "" },
  callout: { tone: "info", markdown: "" },
  deliverable: { title: "", description: "", acceptance_criteria: [], phase: "", owner_side: "activeapps" },
  assumption: { text: "", impact_if_false: "" },
  milestone: { title: "", target_date: null, depends_on: [], status: "planned" },
  pricing_option: { name: "", description: "", price: 0, currency: "ILS", billing: "one_time", includes: [], recommended: false },
  pricing_line: { label: "", quantity: 1, unit_price: 0, currency: "ILS" },
  table: { columns: ["", ""], rows: [["", ""]] },
  file: { storage_path: "", caption: "" },
  image: { storage_path: "", caption: "", alt: "" },
  divider: {},
};

export default function BlockEditor({ documentId, onChanged }: { documentId: string; onChanged: () => Promise<void> }) {
  const { home } = useRoom();
  const t = useT();
  const toast = useToast();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const timers = useRef<Map<string, number>>(new Map());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const load = useCallback(async () => {
    const { data } = await supabase.from("room_blocks").select("*").eq("document_id", documentId).is("deleted_at", null).order("sort_order");
    setBlocks((data as Block[]) ?? []);
  }, [documentId]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (id: string, patch: Partial<Block>) => {
    setSaving("saving");
    const { error } = await supabase.from("room_blocks").update(patch).eq("id", id);
    if (error) { toast.push("error", error.message); setSaving("idle"); return; }
    setSaving("saved");
    window.setTimeout(() => setSaving("idle"), 1200);
  }, [toast]);

  const updateContent = (id: string, content: Record<string, unknown>) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, content } : b)));
    const prev = timers.current.get(id);
    if (prev) window.clearTimeout(prev);
    timers.current.set(id, window.setTimeout(() => { void persist(id, { content }); void onChanged(); }, 600));
  };

  const add = async (type: BlockType, afterId?: string) => {
    const idx = afterId ? blocks.findIndex((b) => b.id === afterId) : blocks.length - 1;
    const prevOrder = idx >= 0 ? blocks[idx].sort_order : 0;
    const nextOrder = blocks[idx + 1]?.sort_order ?? prevOrder + 20;
    const sort_order = Math.floor((prevOrder + nextOrder) / 2) === prevOrder ? prevOrder + 10 : Math.floor((prevOrder + nextOrder) / 2);
    const { data, error } = await supabase.from("room_blocks").insert({ room_id: home.room.id, document_id: documentId, type, content: DEFAULTS[type], sort_order }).select("*").single();
    if (error) { toast.push("error", error.message); return; }
    await load();
    if (sort_order === prevOrder + 10 && blocks[idx + 1]) await renumber();
    setOpen((data as Block).id);
    await onChanged();
  };

  const renumber = async () => {
    const { data } = await supabase.from("room_blocks").select("id, sort_order").eq("document_id", documentId).is("deleted_at", null).order("sort_order");
    const rows = (data as { id: string }[]) ?? [];
    await Promise.all(rows.map((r, i) => supabase.from("room_blocks").update({ sort_order: (i + 1) * 10 }).eq("id", r.id)));
    await load();
  };

  const duplicate = async (b: Block) => {
    const { error } = await supabase.from("room_blocks").insert({ room_id: b.room_id, document_id: documentId, type: b.type, content: b.content, sort_order: b.sort_order + 1 });
    if (error) { toast.push("error", error.message); return; }
    await renumber();
    await onChanged();
  };

  const remove = async (b: Block) => {
    if (!window.confirm(`${t("delete")} — ${blockTitle(b.type, b.content) || b.type}?`)) return;
    const { error } = await supabase.from("room_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", b.id);
    if (error) { toast.push("error", error.message); return; }
    await load();
    await onChanged();
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((b) => b.id === active.id);
    const to = blocks.findIndex((b) => b.id === over.id);
    const next = arrayMove(blocks, from, to).map((b, i) => ({ ...b, sort_order: (i + 1) * 10 }));
    setBlocks(next);
    setSaving("saving");
    await Promise.all(next.filter((b, i) => b.sort_order !== blocks[i]?.sort_order || b.id !== blocks[i]?.id).map((b) => supabase.from("room_blocks").update({ sort_order: b.sort_order }).eq("id", b.id)));
    setSaving("saved");
    window.setTimeout(() => setSaving("idle"), 1200);
    await onChanged();
  };

  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-dim font-mono">{saving === "saving" ? t("unsaved") : saving === "saved" ? t("saved") : ""}</span>
        <AddMenu onPick={(ty) => void add(ty)} label={t("add_block")} />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {blocks.map((b) => (
              <SortableRow key={b.id} block={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} onDuplicate={() => duplicate(b)} onRemove={() => remove(b)} onAddAfter={(ty) => add(ty, b.id)}>
                <BlockForm block={b} onChange={(c) => updateContent(b.id, c)} />
              </SortableRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {blocks.length === 0 && <p className="text-sm text-text-dim">{t("add_block")} ↑</p>}
    </div>
  );
}

function AddMenu({ onPick, label }: { onPick: (t: BlockType) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((v) => !v)}><Plus size={14} />{label}</button>
      {open && (
        <ul className="absolute end-0 mt-1 panel-elevated z-20 w-48 shadow-lg py-1">
          {TYPES.map((ty) => (
            <li key={ty}><button className="w-full text-start px-3 py-1.5 text-sm hover:bg-navy-surface capitalize" onClick={() => { onPick(ty); setOpen(false); }}>{ty.replaceAll("_", " ")}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SortableRow({ block, open, onToggle, onDuplicate, onRemove, onAddAfter, children }: { block: Block; open: boolean; onToggle: () => void; onDuplicate: () => void; onRemove: () => void; onAddAfter: (t: BlockType) => void; children: React.ReactNode }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <li ref={setNodeRef} style={style} className="panel">
      <div className="flex items-center gap-2 px-2 py-2">
        <button className="btn btn-ghost btn-sm !px-1 cursor-grab touch-none" {...attributes} {...listeners} aria-label="drag"><GripVertical size={16} /></button>
        <button className="flex-1 min-w-0 text-start flex items-center gap-2" onClick={onToggle}>
          <span className="badge">{block.type.replaceAll("_", " ")}</span>
          <span className="text-sm truncate text-text-light">{blockTitle(block.type, block.content) || <span className="text-text-faint">—</span>}</span>
        </button>
        <StatusBadge status={block.status} />
        <button className="btn btn-ghost btn-sm !px-1.5" onClick={onDuplicate} title={t("duplicate")}><Copy size={14} /></button>
        <button className="btn btn-ghost btn-sm !px-1.5 text-destructive" onClick={onRemove} title={t("delete")}><Trash2 size={14} /></button>
        <button className="btn btn-ghost btn-sm !px-1.5" onClick={onToggle}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t hairline flex flex-col gap-3">
          {children}
          <div className="flex justify-end"><AddMenu onPick={onAddAfter} label={t("add_block")} /></div>
        </div>
      )}
    </li>
  );
}

function BlockForm({ block, onChange }: { block: Block; onChange: (c: Record<string, unknown>) => void }) {
  const t = useT();
  const c = block.content as Record<string, unknown>;
  const set = (k: string, v: unknown) => onChange({ ...c, [k]: v });
  const lines = (v: unknown) => (Array.isArray(v) ? (v as string[]).join("\n") : "");
  const fromLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : c[k] == null ? "" : String(c[k]));

  switch (block.type) {
    case "heading":
      return (
        <div className="grid sm:grid-cols-[1fr_8rem] gap-3">
          <Field label="Text"><input className="input" value={str("text")} onChange={(e) => set("text", e.target.value)} /></Field>
          <Field label="Level"><select className="select" value={String(c.level ?? 2)} onChange={(e) => set("level", Number(e.target.value))}><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option></select></Field>
        </div>
      );
    case "text":
      return <Field label="Markdown"><textarea className="textarea !min-h-[9rem] font-mono text-sm" value={str("markdown")} onChange={(e) => set("markdown", e.target.value)} /></Field>;
    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Tone"><select className="select" value={str("tone") || "info"} onChange={(e) => set("tone", e.target.value)}><option value="info">info</option><option value="warning">warning</option><option value="success">success</option></select></Field>
          <Field label="Markdown"><textarea className="textarea font-mono text-sm" value={str("markdown")} onChange={(e) => set("markdown", e.target.value)} /></Field>
        </div>
      );
    case "deliverable":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Title"><input className="input" value={str("title")} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Description (Markdown)"><textarea className="textarea" value={str("description")} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label={`${t("acceptance_criteria")} (one per line)`}><textarea className="textarea" value={lines(c.acceptance_criteria)} onChange={(e) => set("acceptance_criteria", fromLines(e.target.value))} /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Phase"><input className="input" value={str("phase")} onChange={(e) => set("phase", e.target.value)} /></Field>
            <Field label={t("owner_side")}><select className="select" value={str("owner_side") || "activeapps"} onChange={(e) => set("owner_side", e.target.value)}><option value="activeapps">ActiveApps</option><option value="client">Client</option></select></Field>
          </div>
        </div>
      );
    case "assumption":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Assumption"><textarea className="textarea !min-h-[4rem]" value={str("text")} onChange={(e) => set("text", e.target.value)} /></Field>
          <Field label={t("impact_if_false")}><input className="input" value={str("impact_if_false")} onChange={(e) => set("impact_if_false", e.target.value)} /></Field>
        </div>
      );
    case "milestone":
      return (
        <div className="grid sm:grid-cols-[1fr_10rem_10rem] gap-3">
          <Field label="Title"><input className="input" value={str("title")} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={t("target_date")}><input className="input" type="date" value={str("target_date")} onChange={(e) => set("target_date", e.target.value || null)} /></Field>
          <Field label="Status"><select className="select" value={str("status") || "planned"} onChange={(e) => set("status", e.target.value)}><option value="planned">planned</option><option value="in_progress">in progress</option><option value="done">done</option></select></Field>
        </div>
      );
    case "pricing_option":
      return (
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><input className="input" value={str("name")} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Description"><input className="input" value={str("description")} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price"><input className="input" type="number" min={0} value={Number(c.price ?? 0)} onChange={(e) => set("price", Number(e.target.value))} dir="ltr" /></Field>
            <Field label="Currency"><select className="select" value={str("currency") || "ILS"} onChange={(e) => set("currency", e.target.value)}><option>ILS</option><option>USD</option><option>EUR</option></select></Field>
            <Field label="Billing"><select className="select" value={str("billing") || "one_time"} onChange={(e) => set("billing", e.target.value)}><option value="one_time">one-time</option><option value="monthly">monthly</option><option value="hourly">hourly</option></select></Field>
          </div>
          <Field label={`${t("includes")} (one per line)`}><textarea className="textarea" value={lines(c.includes)} onChange={(e) => set("includes", fromLines(e.target.value))} /></Field>
          <label className="text-sm flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!c.recommended} onChange={(e) => set("recommended", e.target.checked)} />{t("recommended")}</label>
        </div>
      );
    case "pricing_line":
      return (
        <div className="grid sm:grid-cols-[1fr_6rem_8rem_6rem] gap-3">
          <Field label="Label"><input className="input" value={str("label")} onChange={(e) => set("label", e.target.value)} /></Field>
          <Field label="Qty"><input className="input" type="number" min={0} value={Number(c.quantity ?? 1)} onChange={(e) => set("quantity", Number(e.target.value))} dir="ltr" /></Field>
          <Field label="Unit price"><input className="input" type="number" min={0} value={Number(c.unit_price ?? 0)} onChange={(e) => set("unit_price", Number(e.target.value))} dir="ltr" /></Field>
          <Field label="Currency"><select className="select" value={str("currency") || "ILS"} onChange={(e) => set("currency", e.target.value)}><option>ILS</option><option>USD</option><option>EUR</option></select></Field>
        </div>
      );
    case "table": {
      const cols = (c.columns as string[]) ?? [];
      const rows = (c.rows as string[][]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <Field label="Columns (comma separated)"><input className="input" value={cols.join(", ")} onChange={(e) => set("columns", e.target.value.split(",").map((x) => x.trim()))} /></Field>
          <Field label="Rows (one per line, cells separated by |)"><textarea className="textarea font-mono text-sm" value={rows.map((r) => r.join(" | ")).join("\n")} onChange={(e) => set("rows", e.target.value.split("\n").filter((l) => l.trim()).map((l) => l.split("|").map((x) => x.trim())))} /></Field>
        </div>
      );
    }
    case "file":
    case "image":
      return <FileFields block={block} onChange={onChange} />;
    case "divider":
      return <p className="text-xs text-text-faint">—</p>;
    default:
      return null;
  }
}

function FileFields({ block, onChange }: { block: Block; onChange: (c: Record<string, unknown>) => void }) {
  const { home } = useRoom();
  const toast = useToast();
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const c = block.content as Record<string, string>;
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const path = `${home.room.id}/${block.document_id}/${block.id}-${file.name.replace(/[^\w.\-() ֐-׿]/g, "_")}`;
    const { error } = await supabase.storage.from("room-files").upload(path, file, { upsert: true, contentType: file.type });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    onChange({ ...c, storage_path: path, file_name: file.name });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input ref={ref} type="file" className="hidden" accept={block.type === "image" ? "image/*" : undefined} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <button className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()} disabled={busy}><Upload size={14} />{busy ? t("uploading") : t("upload")}</button>
        <span className="text-xs text-text-dim font-mono truncate" dir="ltr">{c.storage_path || "—"}</span>
      </div>
      <Field label="Caption"><input className="input" value={c.caption ?? ""} onChange={(e) => onChange({ ...c, caption: e.target.value })} /></Field>
      {block.type === "image" && <Field label="Alt text"><input className="input" value={c.alt ?? ""} onChange={(e) => onChange({ ...c, alt: e.target.value })} /></Field>}
    </div>
  );
}
