import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/** Light Markdown → sanitized HTML. Links open in a new tab. */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "u", "s", "a", "ul", "ol", "li", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ADD_ATTR: ["target"],
  }).replaceAll("<a ", '<a target="_blank" rel="noopener noreferrer" ');
}

/** Turn @Name mentions into highlighted spans (after Markdown). */
export function highlightMentions(html: string, names: string[]): string {
  if (!names.length) return html;
  let out = html;
  for (const n of names) {
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${esc}`, "g"), `<span class="text-mint font-medium">@${n}</span>`);
  }
  return out;
}
