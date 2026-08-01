import { createHash } from "node:crypto";

import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import {
  SIMILARITY_ALGORITHM_VERSION,
  SIMILARITY_MODEL_PREFIX
} from "./constants.js";

const MAX_CLEAN_BODY_CHARACTERS = 32_000;
const MAX_LEXICAL_TERMS = 16;
const SKIPPED_ELEMENT_NAMES = new Set([
  "canvas",
  "noscript",
  "script",
  "style",
  "svg",
  "template"
]);
const BLOCK_ELEMENT_NAMES = new Set([
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul"
]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "и",
  "в",
  "во",
  "не",
  "на",
  "с",
  "со",
  "а",
  "но",
  "по",
  "из",
  "за",
  "для",
  "что",
  "це",
  "та",
  "й",
  "у",
  "до",
  "від",
  "із",
  "з",
  "про",
  "як"
]);

export interface SimilaritySourceItem {
  contentHtml: string | null;
  summaryText: string | null;
  title: string | null;
}

export interface PreparedSimilarityText {
  bodyText: string;
  inputHash: string;
  lexicalTerms: string[];
  modelText: string;
  plainTextLength: number;
  summaryText: string;
  titleText: string;
}

export type SimilarityTextResult =
  | {
      kind: "ready";
      value: PreparedSimilarityText;
    }
  | {
      inputHash: string;
      kind: "skipped";
      plainTextLength: number;
      reason: "insufficient_text";
    };

export function prepareSimilarityText(
  item: SimilaritySourceItem
): SimilarityTextResult {
  const titleText = normalizeText(item.title ?? "");
  const summaryText = normalizeText(htmlToPlainText(item.summaryText ?? ""));
  let bodyText = normalizeText(htmlToPlainText(item.contentHtml ?? ""));

  bodyText = removeRepeatedPrefix(bodyText, titleText);
  bodyText = removeRepeatedPrefix(bodyText, summaryText);
  bodyText = bodyText.slice(0, MAX_CLEAN_BODY_CHARACTERS).trim();

  const segments = uniqueSegments([titleText, summaryText, bodyText]);
  const plainText = segments.join("\n\n");
  const inputHash = createHash("sha256")
    .update(`${SIMILARITY_ALGORITHM_VERSION}\0${plainText}`)
    .digest("hex");
  const lexicalTerms = selectLexicalTerms(titleText, summaryText);
  const meaningfulTokens = tokenize(plainText);

  if (meaningfulTokens.length < 3) {
    return {
      inputHash,
      kind: "skipped",
      plainTextLength: plainText.length,
      reason: "insufficient_text"
    };
  }

  return {
    kind: "ready",
    value: {
      bodyText,
      inputHash,
      lexicalTerms,
      modelText: `${SIMILARITY_MODEL_PREFIX}${plainText}`,
      plainTextLength: plainText.length,
      summaryText,
      titleText
    }
  };
}

export function htmlToPlainText(html: string): string {
  if (!html.trim()) {
    return "";
  }

  const fragment = parseFragment(html);
  const parts: string[] = [];

  collectText(fragment, parts);
  return normalizeText(parts.join(""));
}

function collectText(
  node: DefaultTreeAdapterTypes.Node,
  parts: string[]
): void {
  if ("tagName" in node && SKIPPED_ELEMENT_NAMES.has(node.tagName)) {
    return;
  }

  if ("value" in node && typeof node.value === "string") {
    parts.push(node.value);
    return;
  }

  const isBlock = "tagName" in node && BLOCK_ELEMENT_NAMES.has(node.tagName);

  if (isBlock) {
    parts.push(" ");
  }

  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      collectText(child, parts);
    }
  }

  if (isBlock) {
    parts.push(" ");
  }
}

function normalizeText(value: string): string {
  return replaceInvisibleControlCharacters(value.normalize("NFKC"))
    .replace(/\s+/gu, " ")
    .trim();
}

function replaceInvisibleControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isInvisibleControl =
      codePoint <= 8 ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127;

    return isInvisibleControl ? " " : character;
  }).join("");
}

function removeRepeatedPrefix(body: string, segment: string): string {
  if (!body || !segment) {
    return body;
  }

  const normalizedBody = body.toLocaleLowerCase();
  const normalizedSegment = segment.toLocaleLowerCase();

  if (!normalizedBody.startsWith(normalizedSegment)) {
    return body;
  }

  return body.slice(segment.length).replace(/^[\s:;,.!?\-|–—]+/u, "").trim();
}

function uniqueSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const segment of segments) {
    if (!segment) {
      continue;
    }

    const key = segment.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(segment);
  }

  return unique;
}

function selectLexicalTerms(title: string, summary: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const token of [...tokenize(title), ...tokenize(summary)]) {
    if (seen.has(token) || STOP_WORDS.has(token)) {
      continue;
    }

    if (token.length === 1 && !/\d/u.test(token)) {
      continue;
    }

    seen.add(token);
    terms.push(token);

    if (terms.length >= MAX_LEXICAL_TERMS) {
      break;
    }
  }

  return terms;
}

function tokenize(value: string): string[] {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}_+#.-]*/gu)
      ?.map((token) => token.replace(/^[._-]+|[._-]+$/gu, ""))
      .filter(Boolean) ?? []
  );
}
