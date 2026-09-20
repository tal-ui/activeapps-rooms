import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, MessageCircleQuestion, CornerDownLeft, Check, RotateCcw, Lock, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom, canApprove, canComment } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtRelative, blockTitle } from "../lib/format";
import { renderMarkdown, highlightMentions } from "../lib/markdown";
import { useToast } from "../lib/toast";
import { Avatar, StatusBadge } from "./ui";
import { NewQuestionModal } from "../pages/QuestionsPage";
import type { Comment, Question, ViewBlock } from "../lib/types";

const APPROVABLE = new Set(["deliverable", "assumption", "milestone", "pricing_line", "table"]);

export default function BlockPanel({ documentId, block, onClose, onChanged }: { documentId: string; block: ViewBlock | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const { home, me, staffMode, memberById } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    let cq = supabase.from("room_comments").select("*").eq("document_id", documentId).is("deleted_at", null).order("created_at");
    let qq = supabase.from("room_questions").select("*").eq("document_id", documentId).order("created_at", { ascending: false });
    if (block) { cq = cq.eq("block_id", block.id); qq = qq.eq("block_id", block.id); }
    else { cq = cq.is("block_id", null); qq = qq.is("block_id", null); }
    const [c, q] = await Promise.all([cq, qq]);
    setComments((c.data as Comment[]) ?? []);
    setQuestions((q.data as Question[]) ?? []);
  }, [documentId, block]);

  useEffect(() => { void load(); }, [load]);

  // realtime on comments for this document
  useEffect(() => {
    const ch = supabase.channel(`doc-comments:${documentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_comments", filter: `document_id=eq.${documentId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_questions", filter: `document_id=eq.${documentId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [documentId, load]);

  const members = home.members.filter((m) => m.status !== "revoked");
  const names = useMemo(() => members.map((m) => m.full_name).filter(Boolean), [members]);
  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const byParent = new Map<string, Comment[]>();
    for (const c of comments) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
    return roots.map((r) => ({ root: r, replies: byParent.get(r.id) ?? [] }));
  }, [comments]);
  const open = threads.filter((th) => !th.root.resolved_at);
  const resolved = threads.filter((th) => !!th.root.resolved_at);

  const onBodyChange = (v: string) => {
    setBody(v);
    const m = v.match(/@([^\s@]*)$/);
    setMentionQuery(m ? m[1] : null);
  };
  const insertMention = (name: string) => {
    setBody((b) => b.replace(/@([^\s@]*)$/, `@${name} `));
    setMentionQuery(null);
    textRef.current?.focus();
  };

  const submit = async () => {
    if (!me || !body.trim()) return;
    setBusy(true);
    const mentions = members.filter((m) => m.full_name && body.includes(`@${m.full_name}`)).map((m) => m.id);
    const { error } = await supabase.from("room_comments").insert({
      room_id: home.room.id, document_id: documentId, block_id: block?.id ?? null, parent_id: replyTo,
      author_member_id: me.id, body: body.trim(), mentions, internal_only: staffMode && internal,
      version: null,
    });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    setBody(""); setReplyTo(null);
    await load();
    await onChanged();
  };

  const resolve = async (c: Comment, on: boolean) => {
    const { error } = await supabase.from("room_comments").update({ resolved_at: on ? new Date().toISOString() : null, resolved_by: on ? me?.id ?? null : null }).eq("id", c.id);
    if (error) toast.push("error", error.message);
    await load();
    await onChanged();
  };

  const approve = async () => {
    if (!block) return;
    setBusy(true);
    const { error } = await supabase.rpc("room_approve_block", { p_block_id: block.id });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    toast.push("success", t("status_agreed"));
    await onChanged();
  };

  const approver = block?.approved_by_member_id ? memberById(block.approved_by_member_id) : undefined;
  const approvable = !!block && APPROVABLE.has(block.type);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b hairline">
        <div className="min-w-0">
          <p className="label-mono">{block ? block.type.replaceAll("_", " ") : t("documents")}</p>
          <p className="text-sm font-medium truncate">{block ? blockTitle(block.type, block.content) || "—" : t("comments")}</p>
        </div>
        <button className="btn btn-ghost btn-sm lg:hidden" onClick={onClose} aria-label={t("close")}><X size={14} /></button>
      </div>

      {block && approvable && (
        <div className="px-4 py-3 border-b hairline flex items-center gap-3 flex-wrap">
          <StatusBadge status={block.display_status} />
          {block.display_status === "agreed" && approver && (
            <span className="text-xs text-text-dim">{t("approved_by_on", { name: approver.full_name, when: fmtRelative(block.approved_at, lang) })}</span>
          )}
          <span className="flex-1" />
          {canApprove(me) && block.display_status !== "agreed" && (
            <button className="btn btn-primary btn-sm" onClick={approve} disabled={busy}><CheckSquare size={14} />{t("approve")}</button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {questions.length > 0 && (
          <div>
            <p className="label-mono mb-1.5">{t("questions")}</p>
            <ul className="flex flex-col gap-1.5">
              {questions.map((q) => {
                const owner = memberById(q.owner_member_id);
                return (
                  <li key={q.id} className={`rounded-md border px-3 py-2 text-sm ${q.status === "open" ? "border-warning/30 bg-warning/5" : "border-mint/20 bg-mint/5"}`}>
                    <p className="flex items-start gap-2"><MessageCircleQuestion size={14} className={`mt-0.5 shrink-0 ${q.status === "open" ? "text-warning" : "text-mint"}`} />{q.title}</p>
                    <p className="text-xs text-text-dim mt-0.5 ms-6">{t("owner")}: {owner?.full_name ?? t("unassigned")}{q.answer ? ` — ${q.answer}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {open.length === 0 && resolved.length === 0 && <p className="text-sm text-text-dim">{t("no_comments_yet")}</p>}
        {open.map((th) => <Thread key={th.root.id} root={th.root} replies={th.replies} onReply={() => { setReplyTo(th.root.id); textRef.current?.focus(); }} onResolve={(on) => resolve(th.root, on)} names={names} />)}
        {resolved.length > 0 && (
          <div>
            <button className="btn btn-ghost btn-sm text-text-dim" onClick={() => setShowResolved((v) => !v)}>{showResolved ? t("resolved") : t("show_resolved", { n: resolved.length })}</button>
            {showResolved && resolved.map((th) => <Thread key={th.root.id} root={th.root} replies={th.replies} onReply={() => { setReplyTo(th.root.id); textRef.current?.focus(); }} onResolve={(on) => resolve(th.root, on)} names={names} resolved />)}
          </div>
        )}
      </div>

      {canComment(me, staffMode) && me ? (
        <div className="border-t hairline px-4 py-3 flex flex-col gap-2 relative">
          {replyTo && (
            <p className="text-xs text-text-dim flex items-center gap-1"><CornerDownLeft size={12} />{t("reply")} <button className="underline" onClick={() => setReplyTo(null)}>{t("cancel")}</button></p>
          )}
          <textarea ref={textRef} className="textarea !min-h-[4.5rem]" value={body} onChange={(e) => onBodyChange(e.target.value)} placeholder={t("write_comment")} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(); }} />
          {mentionQuery !== null && (
            <ul className="absolute bottom-[5.5rem] inset-inline-start-4 panel-elevated z-10 max-h-40 overflow-auto w-64 shadow-lg">
              {members.filter((m) => m.full_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6).map((m) => (
                <li key={m.id}><button className="w-full text-start px-3 py-1.5 text-sm hover:bg-navy-surface flex items-center gap-2" onClick={() => insertMention(m.full_name)}><Avatar name={m.full_name} side={m.side} size={20} />{m.full_name}</button></li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            {staffMode && (
              <label className="text-xs text-text-dim flex items-center gap-1.5 cursor-pointer" title={t("internal_note")}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><Lock size={11} />{t("internal_only")}</label>
            )}
            <span className="flex-1 text-[0.65rem] text-text-faint flex items-center gap-1.5"><span className="pulse-dot" />{t("sla_note")}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setAskOpen(true)}><MessageCircleQuestion size={14} />{t("ask_question")}</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !body.trim()}>{t("send")}</button>
          </div>
        </div>
      ) : null}

      <NewQuestionModal open={askOpen} onClose={() => setAskOpen(false)} onDone={async () => { await load(); await onChanged(); }} documentId={documentId} blockId={block?.id ?? null} />
    </div>
  );
}

function Thread({ root, replies, onReply, onResolve, names, resolved }: { root: Comment; replies: Comment[]; onReply: () => void; onResolve: (on: boolean) => void; names: string[]; resolved?: boolean }) {
  const { memberById, me, staffMode } = useRoom();
  const t = useT();
  const lang = useLang();
  const canResolve = staffMode || root.author_member_id === me?.id;
  return (
    <div className={`flex flex-col gap-2 ${resolved ? "opacity-60" : ""}`}>
      <CommentRow c={root} names={names} by={memberById(root.author_member_id)} lang={lang} />
      {replies.map((r) => (
        <div key={r.id} className="ms-6"><CommentRow c={r} names={names} by={memberById(r.author_member_id)} lang={lang} /></div>
      ))}
      <div className="ms-8 flex items-center gap-2">
        {!resolved && <button className="btn btn-ghost btn-sm text-text-dim" onClick={onReply}><CornerDownLeft size={12} />{t("reply")}</button>}
        {canResolve && (resolved ? (
          <button className="btn btn-ghost btn-sm text-text-dim" onClick={() => onResolve(false)}><RotateCcw size={12} />{t("unresolve")}</button>
        ) : (
          <button className="btn btn-ghost btn-sm text-text-dim" onClick={() => onResolve(true)}><Check size={12} />{t("resolve")}</button>
        ))}
      </div>
    </div>
  );
}

function CommentRow({ c, names, by, lang }: { c: Comment; names: string[]; by?: { full_name: string; email: string; side: "activeapps" | "client" }; lang: "he" | "en" }) {
  const t = useT();
  return (
    <div className={`flex items-start gap-2.5 ${c.internal_only ? "rounded-md border border-warning/25 bg-warning/5 p-2 -m-2" : ""}`}>
      <Avatar name={by?.full_name} email={by?.email} side={by?.side} size={26} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-dim"><span className="font-medium text-text-light">{by?.full_name ?? "—"}</span> · {fmtRelative(c.created_at, lang)}{c.internal_only && <span className="badge badge-warning ms-2"><Lock size={9} />{t("internal_only")}</span>}</p>
        <div className="prose-room prose-sm" dangerouslySetInnerHTML={{ __html: highlightMentions(renderMarkdown(c.body), names) }} />
      </div>
    </div>
  );
}
