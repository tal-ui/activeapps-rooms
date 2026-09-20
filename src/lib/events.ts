import { translate } from "./i18n";
import type { Language, RoomEvent } from "./types";

/** Human sentence for an event (without the actor). */
export function eventLabel(e: RoomEvent, lang: Language): string {
  const p = e.payload as Record<string, string | number | undefined>;
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (e.type) {
    case "room_created": return translate(lang, "ev_room_created");
    case "member_invited": return translate(lang, "ev_member_invited", { name: s(p.full_name) || s(p.email) });
    case "member_joined": return translate(lang, "ev_member_joined");
    case "version_published": return translate(lang, "ev_version_published", { title: s(p.title), version: s(p.version) });
    case "block_approved": return translate(lang, "ev_block_approved", { title: s(p.title) || s(p.block_type) });
    case "sow_approved": return translate(lang, "ev_sow_approved", { name: s(p.engagement_name) });
    case "pricing_option_selected": return translate(lang, "ev_pricing_option_selected", { name: s(p.option_name) });
    case "comment_added": return translate(lang, "ev_comment_added");
    case "question_asked": return translate(lang, "ev_question_asked", { title: s(p.title) });
    case "question_answered": return translate(lang, "ev_question_answered", { title: s(p.title) });
    case "decision_recorded": return translate(lang, "ev_decision_recorded");
    case "nda_accepted": return translate(lang, "ev_nda_accepted");
    case "file_uploaded": return translate(lang, "ev_file_uploaded", { title: s(p.title) });
    case "room_viewed": return translate(lang, "ev_room_viewed");
    case "document_viewed": return translate(lang, "ev_document_viewed", { title: s(p.title) });
    default: return translate(lang, "ev_generic", { type: e.type.replaceAll("_", " ") });
  }
}
