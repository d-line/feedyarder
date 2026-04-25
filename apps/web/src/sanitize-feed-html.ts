import DOMPurify from "dompurify";

export function sanitizeFeedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_ATTR: ["onerror", "onload", "style"],
    FORBID_TAGS: [
      "base",
      "embed",
      "form",
      "iframe",
      "input",
      "link",
      "meta",
      "object",
      "script",
      "style"
    ],
    USE_PROFILES: {
      html: true
    }
  });
}
