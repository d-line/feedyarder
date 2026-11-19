import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { listSimilarItems } from "./similarity-repository.js";

const readySource = {
  algorithm_version: "similarity-v1",
  compound_lexical_terms: [],
  embedding: "[0.1,0.2]",
  feature_status: "ready",
  feed_id: "00000000-0000-0000-0000-000000000001",
  item_id: "00000000-0000-0000-0000-000000000101",
  lexical_terms: ["postgresql", "vector"],
  published_at: new Date("2026-07-01T00:00:00.000Z"),
  title: "Source",
  url: "https://example.com/source"
};

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
      .mockResolvedValueOnce({ rows: [readySource] })
      .mockResolvedValueOnce({
        rows: [
          sourceDuplicate,
          candidateOne,
          duplicateUrl,
          candidateTwo,
          sameFeedThird
        ]
      });
    const lexicalQuery = vi.fn().mockResolvedValue({ rows: [lexicalOne] });
    const pool = {
      query: queryMock,
      connect: vi.fn().mockResolvedValue({ query: lexicalQuery, release: vi.fn() })
    } as unknown as Pool;

    const response = await listSimilarItems(
      pool,
      readySource.item_id,
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

  it.each([
    {
      terms: ["postgresql"],
      compounds: [],
      rank: "'postgresql'",
      match: "'postgresql'"
    },
    {
      terms: ["interview", "0.1x", "engineer"],
      compounds: ["0.1x"],
      rank: "'interview' | '0.1x' | 'engineer'",
      match: "('interview' <-> '0.1x') | ('0.1x' <-> 'engineer') | '0.1x'"
    }
  ])("filters with $match and ranks using all source terms", async ({
    terms, compounds, rank, match
  }) => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          ...readySource,
          compound_lexical_terms: compounds,
          lexical_terms: terms
        }]
      })
      .mockResolvedValueOnce({ rows: [] });
    const lexicalQuery = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const pool = {
      query,
      connect: vi.fn().mockResolvedValue({ query: lexicalQuery, release })
    } as unknown as Pool;

    await listSimilarItems(pool, readySource.item_id, 5, true);

    expect(lexicalQuery).toHaveBeenNthCalledWith(2, expect.any(String), [
      rank, "similarity-v1", readySource.item_id, match, 150
    ]);
    expect(lexicalQuery).toHaveBeenLastCalledWith("commit");
    expect(release).toHaveBeenCalledWith(false);
  });

  it.each([
    {
      failure: "statement timeout",
      code: "57014",
      routine: "ProcessInterrupts",
      warning: "Similar articles lexical query canceled",
      details: { timeoutMs: 1_000 }
    },
    {
      failure: "could not resize shared memory segment: No space left on device",
      code: "53100",
      routine: "dsm_impl_posix",
      warning: "Similar articles lexical query ran out of shared memory",
      details: { message: "could not resize shared memory segment: No space left on device" }
    }
  ])("rolls back lexical retrieval after $failure and returns strong semantic matches", async ({
    failure, code, routine, warning, details
  }) => {
    const strong = buildCandidate({
      feedId: "00000000-0000-0000-0000-000000000002",
      id: "00000000-0000-0000-0000-000000000201",
      semanticSimilarity: 0.91,
      title: "PostgreSQL vector indexes",
      url: "https://one.example/article"
    });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [readySource] })
      .mockResolvedValueOnce({
        rows: [strong, { ...strong, id: "weak", semantic_similarity: 0.83 }]
      });
    const lexicalQuery = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(Object.assign(new Error(failure), { code, routine }))
      .mockResolvedValueOnce({});
    const release = vi.fn();
    const pool = {
      query,
      connect: vi.fn().mockResolvedValue({ query: lexicalQuery, release })
    } as unknown as Pool;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const response = await listSimilarItems(pool, readySource.item_id, 5, true);
      expect(response?.items.map((item) => item.id)).toEqual([strong.id]);
      expect(warn).toHaveBeenCalledWith(warning, {
        itemId: readySource.item_id,
        ...details
      });
    } finally {
      warn.mockRestore();
    }

    expect(lexicalQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("set local statement_timeout = '1000ms'")
    );
    expect(lexicalQuery).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledWith(false);
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
