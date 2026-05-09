import DOMPurify from "dompurify";

export function sanitizeFeedHtml(html: string): string {
  return DOMPurify.sanitize(decodeEntityEncodedHtml(html), {
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

function decodeEntityEncodedHtml(html: string): string {
  let decoded = html;

  for (let attempt = 0; attempt < 2 && containsEntityEncodedTag(decoded); attempt += 1) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = decoded;
    const nextDecoded = textarea.value;

    if (nextDecoded === decoded) {
      break;
    }

    decoded = nextDecoded;
  }

  return decoded;
}

function containsEntityEncodedTag(html: string): boolean {
  return /&lt;\/?[a-z][\s>/]/iu.test(html);
}
