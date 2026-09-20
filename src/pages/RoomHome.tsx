import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckSquare, MessageCircleQuestion, AtSign, FileText, Lock, Sparkles, X, ShieldCheck, Calendar, Flag, Eye } from "lucide-react";
import { useRoom, canApprove, canInvite } from "../lib/room";
import { useT, useLang } from "../lib/i18n";
import { fmtDate, fmtRelative, daysUntil, blockTitle } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { Avatar, DiamondDivider, EmptyState, PhaseBadge, RoleLabel, SectionTitle, StatusBadge } from "../components/ui";
import { renderMarkdown } from "../lib/markdown";
import InviteMemberModal from "../components/InviteMemberModal";
import type { RoomEvent } from "../lib/types";
import { eventLabel } from "../lib/events";

export default function RoomHome() {
  const { home, me, staffMode, refresh, changes, dismissChanges, presence, memberById } = useRoom();
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const room = home.room;
  const eng = home.current_engagement;
  const delivery = !!eng && ["signed", "active", "completed"].includes(eng.status);
  const validDays = daysUntil(eng?.offer_valid_until);
  const ndaLocked = room.nda_required && !!me && !me.nda_accepted_at && home.documents.some((d) => d.confidential);
  const talName = home.members.find((m) => m.side === "activeapps")?.full_name?.split(" ")[0] ?? "ActiveApps";

  const acceptNda = async () => {
    const { error } = await supabase.rpc("room_accept_nda", { p_room_id: room.id });
    if (error) toast.push("error", error.message);
    else {
      toast.push("success", t("nda_accepted"));
      await refresh();
    }
  };

  // ---- next steps (personal checklist) ----
  const steps: { key: string; icon: typeof CheckSquare; label: string; to?: string; onClick?: () => void; primary?: boolean }[] = [];
  if (ndaLocked) steps.push({ key: "nda", icon: ShieldCheck, label: t("step_accept_nda"), onClick: acceptNda, primary: true });
  if (canApprove(me) && eng && eng.status === "shared" && home.readiness?.ready && home.sow)
    steps.push({ key: "sow", icon: CheckSquare, label: t("step_approve_sow"), to: `/r/${room.slug}/doc/${home.sow.id}?approve=1`, primary: true });
  if (canApprove(me) && eng && eng.status === "shared" && !eng.selected_pricing_option_block_id && home.sow)
    steps.push({ key: "pricing", icon: Sparkles, label: t("step_choose_pricing"), to: `/r/${room.slug}/doc/${home.sow.id}#pricing` });
  for (const b of home.my_pending_blocks.slice(0, 5))
    steps.push({ key: `b-${b.id}`, icon: CheckSquare, label: t("step_approve_block", { title: b.title ?? b.type }), to: `/r/${room.slug}/doc/${b.document_id}?block=${b.id}` });
  for (const q of home.my_questions.slice(0, 5))
    steps.push({ key: `q-${q.id}`, icon: MessageCircleQuestion, label: t("step_answer_question", { title: q.title }), to: `/r/${room.slug}/questions?q=${q.id}` });
  for (const m of home.my_mentions.slice(0, 3))
    steps.push({ key: `m-${m.id}`, icon: AtSign, label: t("step_mention"), to: m.document_id ? `/r/${room.slug}/doc/${m.document_id}?block=${m.block_id ?? ""}` : `/r/${room.slug}/activity` });

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* ---- What changed since your last visit ---- */}
      {changes.length > 0 && (
        <section className="panel-elevated border-mint/25 p-4 sm:p-5 animate-slide-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-mint/15 text-mint"><Sparkles size={16} /></span>
              <div>
                <h2 className="font-semibold">{t("what_changed")}</h2>
                <p className="text-xs text-text-dim">{t("what_changed_count", { n: changes.length })}</p>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={dismissChanges}><X size={14} />{t("dismiss")}</button>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {changes.slice(0, 8).map((e) => (
              <li key={e.id}>
                <ChangeRow e={e} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Where we stand ---- */}
      <section className="panel p-4 sm:p-5">
        <SectionTitle>{t("where_we_stand")}</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Stat label={t("phase")}><PhaseBadge phase={room.phase} /></Stat>
          {delivery ? (
            <>
              <Stat label={t("current_engagement")}>{eng?.name ?? "—"}</Stat>
              <Stat label={t("next_milestone")}>
                {room.next_milestone_label ? (
                  <span>{room.next_milestone_label}<span className="text-text-dim text-xs ms-2">{fmtDate(room.next_milestone_date, lang)}</span></span>
                ) : home.milestones.find((m) => m.content.status !== "done")?.content.title ?? "—"}
              </Stat>
              <Stat label={t("open_questions")}><Link to={`/r/${room.slug}/questions`} className="text-mint hover:underline">{home.open_questions}</Link></Stat>
            </>
          ) : (
            <>
              <Stat label={t("current_engagement")}>
                {eng ? (
                  <span className="flex flex-col">
                    <span className="truncate">{eng.name}</span>
                    {home.sow && <span className="text-xs text-text-dim">{t("sow_version")} {home.sow.current_version > 0 ? `v${home.sow.current_version}` : t("draft")}</span>}
                  </span>
                ) : "—"}
              </Stat>
              <Stat label={t("pending_approval")}>
                {home.readiness ? (
                  <span className={home.readiness.pending === 0 && home.readiness.total > 0 ? "text-mint" : ""}>
                    {home.readiness.pending === 0 && home.readiness.total > 0 ? t("status_agreed") : t("blocks_pending", { n: home.readiness.pending })}
                  </span>
                ) : "—"}
              </Stat>
              <Stat label={t("open_questions")}><Link to={`/r/${room.slug}/questions`} className="text-mint hover:underline">{home.open_questions}</Link></Stat>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-dim">
          {eng?.kickoff_date && <span className="inline-flex items-center gap-1"><Calendar size={12} />{t("kickoff")}: {fmtDate(eng.kickoff_date, lang)}</span>}
          {eng?.offer_valid_until && !delivery && (
            <span className={`inline-flex items-center gap-1 ${validDays !== null && validDays < 0 ? "text-destructive" : validDays !== null && validDays <= 5 ? "text-warning" : ""}`}>
              <Flag size={12} />
              {validDays !== null && validDays < 0 ? t("offer_expired") : validDays !== null && validDays <= 5 ? t("offer_expires_soon", { n: validDays }) : `${t("offer_valid_until")} ${fmtDate(eng.offer_valid_until, lang)}`}
            </span>
          )}
          {room.status_note && <span>{room.status_note}</span>}
          {presence.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-mint"><span className="pulse-dot" />{t("viewing_now", { name: presence.map((p) => p.name).join(", ") })}</span>
          )}
        </div>
        {eng?.status === "agreed" && eng.agreement_record && (
          <div className="mt-3 text-xs text-mint inline-flex items-center gap-1.5">
            <ShieldCheck size={13} />
            {t("sow_approved_banner", { name: String(eng.agreement_record.full_name ?? ""), when: fmtDate(String(eng.agreement_record.approved_at ?? ""), lang), version: String(eng.agreement_record.version ?? "") })}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-6 sm:gap-8">
        <div className="flex flex-col gap-6 sm:gap-8 min-w-0">
          {/* ---- Welcome ---- */}
          {room.welcome_message && (
            <section className="doc-surface p-5 sm:p-6">
              <p className="label-mono mb-3">{t("welcome_from", { name: talName })}</p>
              {room.welcome_video_url && (
                <div className="aspect-video rounded-lg overflow-hidden mb-4 border hairline">
                  <iframe src={room.welcome_video_url} className="w-full h-full" allow="autoplay; fullscreen" title="welcome" />
                </div>
              )}
              <div className="prose-room" dangerouslySetInnerHTML={{ __html: renderMarkdown(room.welcome_message) }} />
            </section>
          )}

          {/* ---- Next steps ---- */}
          {me && (
            <section>
              <SectionTitle>{t("your_next_steps")}</SectionTitle>
              {steps.length === 0 ? (
                <p className="text-sm text-text-dim panel px-4 py-3">{t("next_steps_empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {steps.map((s) => (
                    <li key={s.key}>
                      <button
                        className={`w-full text-start panel px-4 py-3 flex items-center gap-3 hover:border-mint/30 transition-colors cursor-pointer ${s.primary ? "border-mint/30 glow-mint" : ""}`}
                        onClick={() => (s.to ? navigate(s.to) : s.onClick?.())}
                      >
                        <s.icon size={16} className={s.primary ? "text-mint" : "text-text-dim"} />
                        <span className="flex-1 text-sm">{s.label}</span>
                        <ArrowRight size={14} className="text-text-faint rtl:rotate-180" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ---- Milestones (delivery mode) ---- */}
          {delivery && home.milestones.length > 0 && (
            <section>
              <SectionTitle>{t("milestones")}</SectionTitle>
              <ol className="panel divide-y divide-white/5">
                {home.milestones.map((m) => (
                  <li key={m.id} className="px-4 py-3 flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${m.content.status === "done" ? "bg-mint" : m.content.status === "in_progress" ? "bg-warning" : "bg-navy-surface border border-white/15"}`} />
                    <span className="flex-1 text-sm">{m.content.title}</span>
                    <span className="text-xs text-text-dim">{fmtDate(m.content.target_date ?? null, lang)}</span>
                    <span className="badge">{t(m.content.status === "done" ? "milestone_done" : m.content.status === "in_progress" ? "milestone_in_progress" : "milestone_planned")}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---- Documents ---- */}
          <section>
            <SectionTitle>{t("documents")}</SectionTitle>
            {home.documents.length === 0 ? (
              <EmptyState body={t("documents_empty")} />
            ) : (
              <div className="flex flex-col gap-4">
                {home.engagements.map((e) => {
                  const docs = home.documents.filter((d) => d.engagement_id === e.id);
                  if (!docs.length) return null;
                  return (
                    <div key={e.id}>
                      <p className="text-xs text-text-dim mb-1.5 flex items-center gap-2">{e.name}<span className="badge">{e.status}</span></p>
                      <DocList docs={docs} slug={room.slug} />
                    </div>
                  );
                })}
                {home.documents.some((d) => !d.engagement_id) && (
                  <div>
                    <DocList docs={home.documents.filter((d) => !d.engagement_id)} slug={room.slug} />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6 sm:gap-8">
          {/* ---- Team ---- */}
          <section>
            <SectionTitle action={canInvite(me, staffMode) ? <button className="btn btn-ghost btn-sm" onClick={() => setInviteOpen(true)}>{t("invite_colleague")}</button> : undefined}>{t("team")}</SectionTitle>
            <div className="panel divide-y divide-white/5">
              {(["client", "activeapps"] as const).map((side) => {
                const members = home.members.filter((m) => m.side === side);
                if (!members.length) return null;
                return (
                  <div key={side} className="px-4 py-3">
                    <p className="label-mono mb-2">{side === "activeapps" ? t("side_activeapps") : room.client_name}</p>
                    <ul className="flex flex-col gap-2.5">
                      {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-2.5">
                          <Avatar name={m.full_name} email={m.email} side={m.side} size={30} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">{m.full_name || m.email}{me?.id === m.id && <span className="text-text-faint text-xs ms-1">({t("you")})</span>}</p>
                            <p className="text-xs text-text-dim truncate">{m.title ? `${m.title} · ` : ""}<RoleLabel role={m.role} /></p>
                          </div>
                          {presence.some((p) => p.member_id === m.id) ? (
                            <span className="pulse-dot" title={t("viewing_now", { name: m.full_name })} />
                          ) : staffMode && m.side === "client" ? (
                            <span className="text-[0.65rem] text-text-faint inline-flex items-center gap-1" title={m.last_seen_at ? t("last_seen", { when: fmtRelative(m.last_seen_at, lang) }) : t("never_visited")}>
                              <Eye size={11} />{m.status === "invited" ? t("status_invited") : m.last_seen_at ? fmtRelative(m.last_seen_at, lang) : "—"}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Recent activity ---- */}
          <section>
            <SectionTitle action={<Link to={`/r/${room.slug}/activity`} className="btn btn-ghost btn-sm">{t("view_all_activity")}</Link>}>{t("recent_activity")}</SectionTitle>
            {home.recent_events.length === 0 ? (
              <p className="text-sm text-text-dim panel px-4 py-3">{t("activity_empty")}</p>
            ) : (
              <ul className="panel divide-y divide-white/5">
                {home.recent_events.slice(0, 6).map((e) => {
                  const actor = memberById(e.actor_member_id);
                  return (
                    <li key={e.id} className="px-4 py-2.5 flex items-start gap-2.5">
                      <Avatar name={actor?.full_name} email={actor?.email} side={actor?.side} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-light"><span className="font-medium">{actor?.full_name?.split(" ")[0] ?? "—"}</span> {eventLabel(e, lang)}</p>
                        <p className="text-[0.65rem] text-text-faint">{fmtRelative(e.created_at, lang)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <DiamondDivider />
      <p className="text-center text-xs text-text-faint flex items-center justify-center gap-2 lg:hidden"><span className="pulse-dot" />{t("sla_note")}</p>

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-mono mb-1">{label}</p>
      <div className="text-sm font-medium text-foreground truncate">{children}</div>
    </div>
  );
}

function DocList({ docs, slug }: { docs: import("../lib/types").RoomDocument[]; slug: string }) {
  const t = useT();
  const lang = useLang();
  return (
    <ul className="panel divide-y divide-white/5">
      {docs.map((d) => (
        <li key={d.id}>
          <Link to={d.locked ? "#" : d.kind === "file" ? `/r/${slug}/files#${d.id}` : `/r/${slug}/doc/${d.id}`} className={`px-4 py-3 flex items-center gap-3 hover:bg-navy-light/60 transition-colors ${d.locked ? "opacity-60 cursor-not-allowed" : ""}`}>
            {d.locked ? <Lock size={16} className="text-text-dim" /> : <FileText size={16} className="text-mint" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{d.title}</p>
              <p className="text-xs text-text-dim">
                <span className="uppercase font-mono tracking-wider">{d.kind}</span>
                {d.kind !== "file" && d.current_version > 0 && ` · v${d.current_version}`}
                {d.status === "draft" && ` · ${t("draft")}`}
                {` · ${fmtRelative(d.updated_at, lang)}`}
              </p>
            </div>
            {d.confidential && <span className="badge badge-warning">{t("confidential")}</span>}
            {d.status === "draft" && <StatusBadge status="draft" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ChangeRow({ e }: { e: RoomEvent }) {
  const { memberById, home } = useRoom();
  const lang = useLang();
  const actor = memberById(e.actor_member_id);
  const p = e.payload as Record<string, string | number | undefined>;
  const href = e.type === "version_published" ? `/r/${home.room.slug}/doc/${e.entity_id}` : e.type === "question_answered" ? `/r/${home.room.slug}/questions` : e.type === "block_approved" ? `/r/${home.room.slug}/doc/${p.document_id}?block=${e.entity_id}` : `/r/${home.room.slug}/activity`;
  return (
    <Link to={href} className="flex items-start gap-2 text-sm hover:text-mint transition-colors">
      <span className="text-mint mt-1.5 w-1.5 h-1.5 rounded-full bg-mint shrink-0" />
      <span className="text-text-light">
        <span className="font-medium">{actor?.full_name?.split(" ")[0] ?? "ActiveApps"}</span> {eventLabel(e, lang)}
        {e.type === "version_published" && p.change_summary ? <span className="text-text-dim"> — {String(p.change_summary)}</span> : null}
      </span>
    </Link>
  );
}

export { blockTitle };
