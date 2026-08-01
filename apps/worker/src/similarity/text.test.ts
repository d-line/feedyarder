import { describe, expect, it } from "vitest";

import { htmlToPlainText, prepareSimilarityText } from "./text.js";

describe("similarity text", () => {
  it("extracts visible text and removes executable or metadata elements", () => {
    expect(
      htmlToPlainText(`
        <article>
          <h1>Useful title</h1>
          <script>secretScript()</script>
          <style>.hidden { display:none }</style>
          <p>First &amp; second.</p>
          <svg><text>diagram label</text></svg>
        </article>
      `)
    ).toBe("Useful title First & second.");
  });

  it("builds deterministic model and lexical features without repeated prefixes", () => {
    const input = {
      contentHtml:
        "<p>PostgreSQL vector search</p><p>HNSW makes neighbor lookup fast.</p>",
      summaryText: "PostgreSQL vector search",
      title: "PostgreSQL vector search"
    };
    const first = prepareSimilarityText(input);
    const second = prepareSimilarityText(input);

    expect(first).toEqual(second);
    expect(first.kind).toBe("ready");

    if (first.kind !== "ready") {
      throw new Error("Expected ready similarity text.");
    }

    expect(first.value.modelText).toBe(
      "query: PostgreSQL vector search\n\nHNSW makes neighbor lookup fast."
    );
    expect(first.value.lexicalTerms).toEqual([
      "postgresql",
      "vector",
      "search"
    ]);
    expect(first.value.inputHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps multilingual text and accepts a short informative title", () => {
    const result = prepareSimilarityText({
      contentHtml: null,
      summaryText: null,
      title: "Новий реліз PostgreSQL"
    });

    expect(result.kind).toBe("ready");

    if (result.kind === "ready") {
      expect(result.value.lexicalTerms).toEqual([
        "новий",
        "реліз",
        "postgresql"
      ]);
    }
  });

  it("skips items without enough meaningful text", () => {
    const result = prepareSimilarityText({
      contentHtml: "<p>Hi</p>",
      summaryText: null,
      title: "Hi"
    });

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "insufficient_text"
    });
  });
});
