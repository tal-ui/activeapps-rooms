// Bilingual notification copy (spec §4.9: the e-mail carries the content itself).
export type Lang = "he" | "en";

const T = {
  he: {
    mention_subject: (who: string, room: string) => `${who} אזכר/ה אותך ב-${room}`,
    mention_heading: (who: string) => `${who} אזכר/ה אותך בתגובה`,
    question_subject: (who: string, title: string) => `שאלה בשבילך: ${title}`,
    question_heading: (who: string) => `${who} שאל/ה אותך`,
    answer_subject: (title: string) => `תשובה לשאלה שלך: ${title}`,
    answer_heading: (who: string) => `${who} ענה/תה על השאלה שלך`,
    version_subject: (title: string, v: number) => `גרסה חדשה: ${title} v${v}`,
    version_heading: (title: string, v: number) => `${title} — גרסה ${v} פורסמה`,
    changed_subject: (title: string) => `בלוק שאישרת השתנה: ${title}`,
    changed_heading: () => `בלוק שאישרת עודכן ודורש אישור מחדש`,
    sow_subject: (name: string) => `ה-SOW אושר: ${name}`,
    sow_heading: (name: string) => `${name} — היקף העבודה אושר`,
    digest_subject: (room: string) => `מה מחכה לך בחדר ${room}`,
    digest_heading: (room: string) => `הצעדים הבאים שלך ב-${room}`,
    expiry_subject: (days: number, name: string) => days <= 1 ? `ההצעה ${name} פגה מחר` : `ההצעה ${name} פגה בעוד ${days} ימים`,
    expiry_heading: (days: number) => days <= 1 ? `תוקף ההצעה מסתיים מחר` : `תוקף ההצעה מסתיים בעוד ${days} ימים`,
    open: "פתיחה בחדר",
    open_question: "מענה בחדר",
    open_doc: "פתיחת המסמך",
    pending_blocks: (n: number) => `${n} בלוקים ממתינים לאישורך`,
    owned_questions: (n: number) => `${n} שאלות ממתינות לתשובתך`,
    mentions: (n: number) => `${n} אזכורים שלא נענו`,
    footer: "קיבלת מייל זה כי את/ה חבר/ה בחדר. אפשר לשנות העדפות התראה בתוך החדר. אנחנו עונים תוך יום עסקים.",
    due: "נדרש עד",
  },
  en: {
    mention_subject: (who: string, room: string) => `${who} mentioned you in ${room}`,
    mention_heading: (who: string) => `${who} mentioned you in a comment`,
    question_subject: (who: string, title: string) => `Question for you: ${title}`,
    question_heading: (who: string) => `${who} asked you a question`,
    answer_subject: (title: string) => `Answer to your question: ${title}`,
    answer_heading: (who: string) => `${who} answered your question`,
    version_subject: (title: string, v: number) => `New version: ${title} v${v}`,
    version_heading: (title: string, v: number) => `${title} — version ${v} published`,
    changed_subject: (title: string) => `A block you approved changed: ${title}`,
    changed_heading: () => `A block you approved was updated and needs re-approval`,
    sow_subject: (name: string) => `SOW approved: ${name}`,
    sow_heading: (name: string) => `${name} — scope of work approved`,
    digest_subject: (room: string) => `What's waiting for you in ${room}`,
    digest_heading: (room: string) => `Your next steps in ${room}`,
    expiry_subject: (days: number, name: string) => days <= 1 ? `The ${name} offer expires tomorrow` : `The ${name} offer expires in ${days} days`,
    expiry_heading: (days: number) => days <= 1 ? `The offer expires tomorrow` : `The offer expires in ${days} days`,
    open: "Open in the room",
    open_question: "Answer in the room",
    open_doc: "Open the document",
    pending_blocks: (n: number) => `${n} block${n === 1 ? "" : "s"} awaiting your approval`,
    owned_questions: (n: number) => `${n} question${n === 1 ? "" : "s"} waiting for your answer`,
    mentions: (n: number) => `${n} unanswered mention${n === 1 ? "" : "s"}`,
    footer: "You received this because you are a member of the room. Notification preferences can be changed inside the room. We reply within one business day.",
    due: "Needed by",
  },
};

export function str(lang: Lang) {
  return T[lang] ?? T.en;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
