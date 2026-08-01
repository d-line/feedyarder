import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listSimilarItems } from "./similarity-repository.js";

describe("similarity repository", () => {
  it("returns pending without running candidate queries", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          algorithm_version: null,
          embedding: null,
          feature_status: null,
          feed_id: "00000000-0000-0000-0000-000000000001",
          item_id: "00000000-0000-0000-0000-000000000101",
          lexical_terms: null,
          published_at: new Date("2026-07-01T00:00:00.000Z"),
          title: "Source",
          url: "https://example.com/source"
        }
      ]
    });
    const pool = { query: queryMock } as unknown as Pool;

    await expect(
      listSimilarItems(
        pool,
        "00000000-0000-0000-0000-000000000101",
        5,
        true
      )
    ).resolves.toEqual({
      count: 0,
      hasMore: false,
      items: [],
      status: "pending"
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("hybrid-ranks candidates and suppresses duplicate URLs and excess feed rows", async () => {
    const source = {
      algorithm_version: "similarity-v1",
      embedding: "[0.1,0.2]",
      feature_status: "ready",
      feed_id: "00000000-0000-0000-0000-000000000001",
      item_id: "00000000-0000-0000-0000-000000000101",
      lexical_terms: ["postgresql", "vector"],
      published_at: new Date("2026-07-01T00:00:00.000Z"),
      title: "Source",
      url: "https://example.com/source"
    };
    const candidateOne = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000002",
      id: "00000000-0000-0000-0000-000000000201",
      semanticSimilarity: 0.91,
      title: "PostgreSQL vector indexes",
      url: "https://one.example/article"
    });
    const sourceDuplicate = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000004",
      id: "00000000-0000-0000-0000-000000000205",
      semanticSimilarity: 0.92,
      title: "Different wording for the same canonical article",
      url: "https://example.com/source#syndicated"
    });
    const duplicateUrl = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000003",
      id: "00000000-0000-0000-0000-000000000202",
      semanticSimilarity: 0.9,
      title: "A syndicated copy with different words",
      url: "https://one.example/article#copy"
    });
    const candidateTwo = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000002",
      id: "00000000-0000-0000-0000-000000000203",
      semanticSimilarity: 0.88,
      title: "Nearest-neighbor queries",
      url: "https://two.example/article"
    });
    const sameFeedThird = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000002",
      id: "00000000-0000-0000-0000-000000000204",
      semanticSimilarity: 0.86,
      title: "A third result from one feed",
      url: "https://three.example/article"
    });
    const lexicalOne = {
      ...candidateOne,
      lexical_rank: 0.4
    };
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [source] })
      .mockResolvedValueOnce({
        rows: [
          sourceDuplicate,
          candidateOne,
          duplicateUrl,
          candidateTwo,
          sameFeedThird
        ]
      })
      .mockResolvedValueOnce({ rows: [lexicalOne] });
    const pool = { query: queryMock } as unknown as Pool;

    const response = await listSimilarItems(
      pool,
      source.item_id,
      5,
      true
    );

    expect(response?.status).toBe("ready");
    expect(response?.items.map((item) => item.id)).toEqual([
      candidateOne.id,
      candidateTwo.id
    ]);
    expect(response?.count).toBe(2);
    expect(response?.hasMore).toBe(false);
  });
});

function buildCandidate(input: {
  feedId: string;
  id: string;
  semanticSimilarity: number;
  title: string;
  url: string;
}) {
  return {
    author: null,
    content_html: "<p>body</p>",
    created_at: new Date("2026-07-01T00:00:00.000Z"),
    feed_id: input.feedId,
    feed_title: "Feed",
    id: input.id,
    is_read: false,
    is_starred: false,
    published_at: new Date("2026-07-01T00:00:00.000Z"),
    raw_extension_data: {},
    semantic_similarity: input.semanticSimilarity,
    summary_text: "summary",
    title: input.title,
    url: input.url
  };
}
