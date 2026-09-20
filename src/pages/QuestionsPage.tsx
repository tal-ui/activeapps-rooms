import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MessageCircleQuestion, CheckCircle2, Clock, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useRoom, canComment } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtDate, fmtRelative, daysUntil } from "../lib/format";
import { useToast } from "../lib/toast";
import { Avatar, EmptyState, Field, Modal, SectionTitle, Skeleton } from "../components/ui";
import type { Question, Decision } from "../lib/types";

type Tab = "open" | "overdue" | "answered" | "mine";

export default function QuestionsPage() {
  const { home, me, staffMode, memberById, refresh } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [answering, setAnswering] = useState<Question | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    const [q, d] = await Promise.all([
      supabase.from("room_questions").select("*").eq("room_id", home.room.id).order("created_at", { ascending: false }),
      supabase.from("room_decisions").select("*").eq("room_id", home.room.id).order("decided_at", { ascending: false }).limit(100),
    ]);
    setQuestions((q.data as Question[]) ?? []);
    setDecisions((d.data as Decision[]) ?? []);
  }, [home.room.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const qid = params.get("q");
    if (qid && questions) {
      const q = questions.find((x) => x.id === qid);
      if (q && q.status === "open") setAnswering(q);
    }
  }, [params, questions]);

  const list = useMemo(() => {
    const all = questions ?? [];
    switch (tab) {
      case "open": return all.filter((q) => q.status === "open");
      case "overdue": return all.filter((q) => q.status === "open" && q.due_date && (daysUntil(q.due_date) ?? 0) < 0);
      case "answered": return all.filter((q) => q.status !== "open");
      case "mine": return all.filter((q) => q.owner_member_id === me?.id || q.asked_by_member_id === me?.id);
    }
  }, [questions, tab, me?.id]);

  const counts = {
    open: (questions ?? []).filter((q) => q.status === "open").length,
    overdue: (questions ?? []).filter((q) => q.status === "open" && q.due_date && (daysUntil(q.due_date) ?? 0) < 0).length,
    answered: (questions ?? []).filter((q) => q.status !== "open").length,
    mine: (questions ?? []).filter((q) => q.owner_member_id === me?.id || q.asked_by_member_id === me?.id).length,
  };

  return (
    <div className="grid lg:grid-cols-[1fr_22rem] gap-8">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-lg font-semibold">{t("questions_title")}</h1>
          {canComment(me, staffMode) && (
            <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={14} />{t("new_question")}</button>
          )}
        </div>
        <div className="flex gap-1 mb-4 overflow-x-auto">
          {(["open", "overdue", "answered", "mine"] as Tab[]).map((k) => (
            <button key={k} className={`btn btn-sm ${tab === k ? "btn-secondary" : "btn-ghost"}`} onClick={() => setTab(k)}>
              {t(`questions_${k}` as "questions_open")}
              <span className="badge !py-0">{counts[k]}</span>
            </button>
          ))}
        </div>
        {questions === null ? (
          <div className="flex flex-col gap-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState body={t("questions_empty")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((q) => {
              const owner = memberById(q.owner_member_id);
              const asker = memberById(q.asked_by_member_id);
              const due = daysUntil(q.due_date);
              const canAnswer = q.status === "open" && (staffMode || q.owner_member_id === me?.id);
              return (
                <li key={q.id} className="panel p-4">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 ${q.status === "open" ? "text-warning" : "text-mint"}`}>{q.status === "open" ? <MessageCircleQuestion size={18} /> : <CheckCircle2 size={18} />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{q.title}</p>
                      {q.body && <p className="text-sm text-text-mid mt-1 whitespace-pre-wrap">{q.body}</p>}
                      {q.answer && (
                        <div className="mt-2 rounded-md bg-mint/8 border border-mint/20 px-3 py-2 text-sm text-text-light">
                          <span className="label-mono !text-mint block mb-0.5">{t("answer")}</span>{q.answer}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-dim">
                        <span className="inline-flex items-center gap-1.5"><Avatar name={asker?.full_name} email={asker?.email} side={asker?.side} size={16} />{t("asked_by", { name: asker?.full_name ?? "—" })} · {fmtRelative(q.created_at, lang)}</span>
                        <span className="inline-flex items-center gap-1.5">{t("owner")}: {owner ? <><Avatar name={owner.full_name} email={owner.email} side={owner.side} size={16} />{owner.full_name}</> : t("unassigned")}</span>
                        {q.due_date && q.status === "open" && (
                          <span className={`inline-flex items-center gap-1 ${due !== null && due < 0 ? "text-destructive" : due === 0 ? "text-warning" : ""}`}>
                            <Clock size={11} />{due !== null && due < 0 ? t("overdue_by", { n: -due }) : due === 0 ? t("due_today") : fmtDate(q.due_date, lang)}
                          </span>
                        )}
                        {q.document_id && <Link to={`/r/${home.room.slug}/doc/${q.document_id}${q.block_id ? `?block=${q.block_id}` : ""}`} className="text-mint hover:underline">{t("linked_block")}</Link>}
                      </div>
                    </div>
                    {canAnswer && <button className="btn btn-secondary btn-sm" onClick={() => setAnswering(q)}>{t("answer")}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside>
        <SectionTitle>{t("decision_log")}</SectionTitle>
        {decisions.length === 0 ? (
          <p className="text-sm text-text-dim panel px-4 py-3">{t("decisions_empty")}</p>
        ) : (
          <ol className="panel divide-y divide-white/5">
            {decisions.map((d) => {
              const by = memberById(d.decided_by_member_id);
              const q = questions?.find((x) => x.id === d.question_id);
              return (
                <li key={d.id} className="px-4 py-3">
                  <p className="text-sm text-text-light">{d.text}</p>
                  <p className="text-[0.65rem] text-text-faint mt-1 font-mono">{by?.full_name ?? "—"} · {fmtDate(d.decided_at, lang)}</p>
                  {q && <p className="text-xs text-text-dim mt-0.5 truncate">↳ {q.title}</p>}
                  {q?.document_id && <Link to={`/r/${home.room.slug}/doc/${q.document_id}${q.block_id ? `?block=${q.block_id}` : ""}`} className="text-xs text-mint hover:underline">{t("linked_block")}</Link>}
                </li>
              );
            })}
          </ol>
        )}
      </aside>

      <AnswerModal
        q={answering}
        onClose={() => { setAnswering(null); if (params.get("q")) { params.delete("q"); setParams(params, { replace: true }); } }}
        onDone={async () => { await load(); await refresh(); }}
      />
      <NewQuestionModal open={newOpen} onClose={() => setNewOpen(false)} onDone={async () => { await load(); await refresh(); toast.push("success", t("saved")); }} />
    </div>
  );
}

function AnswerModal({ q, onClose, onDone }: { q: Question | null; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [answer, setAnswer] = useState("");
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAnswer(""); setDecision(""); }, [q?.id]);
  if (!q) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("room_answer_question", { p_question_id: q.id, p_answer: answer, p_decision_text: decision || null });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    await onDone();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={q.title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {q.body && <p className="text-sm text-text-mid whitespace-pre-wrap">{q.body}</p>}
        <Field label={t("answer")}>
          <textarea className="textarea" required autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t("answer_placeholder")} />
        </Field>
        <Field label={`${t("decision_text")} (${t("optional")})`} hint={t("change_summary_auto")}>
          <input className="input" value={decision} onChange={(e) => setDecision(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t("record_answer")}</button>
        </div>
      </form>
    </Modal>
  );
}

export function NewQuestionModal({ open, onClose, onDone, documentId, blockId }: { open: boolean; onClose: () => void; onDone: () => Promise<void>; documentId?: string | null; blockId?: string | null }) {
  const { home, me } = useRoom();
  const t = useT();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [owner, setOwner] = useState<string>("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && !owner) {
      // default owner: the other side's first member
      const other = home.members.find((m) => m.side !== me?.side && m.status !== "revoked");
      setOwner(other?.id ?? "");
    }
  }, [open, owner, home.members, me?.side]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    const { error } = await supabase.from("room_questions").insert({
      room_id: home.room.id, document_id: documentId ?? null, block_id: blockId ?? null,
      title: title.trim(), body: body.trim() || null, asked_by_member_id: me.id, owner_member_id: owner || null, due_date: due || null,
    });
    setBusy(false);
    if (error) { toast.push("error", error.message); return; }
    setTitle(""); setBody(""); setDue("");
    await onDone();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={t("ask_question")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("question_title")}>
          <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={`${t("question_details")} (${t("optional")})`}>
          <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("question_owner")}>
            <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("unassigned")}</option>
              {home.members.filter((m) => m.status !== "revoked").map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || m.email} ({m.side === "activeapps" ? "ActiveApps" : home.room.client_name})</option>
              ))}
            </select>
          </Field>
          <Field label={`${t("question_due")} (${t("optional")})`}>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-text-faint flex items-center gap-2"><span className="pulse-dot" />{t("sla_note")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t("send")}</button>
        </div>
      </form>
    </Modal>
  );
}
