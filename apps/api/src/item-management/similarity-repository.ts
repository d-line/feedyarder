import type { Pool } from "pg";

import {
  mapItem,
  type ItemResponse,
  type ItemRow
} from "./repository.js";

const SIMILARITY_ALGORITHM_VERSION = "similarity-v1";
const SEMANTIC_CANDIDATE_LIMIT = 150;
const LEXICAL_CANDIDATE_LIMIT = 150;
const MINIMUM_SEMANTIC_SIMILARITY = 0.8;
const STRONG_SEMANTIC_SIMILARITY = 0.86;
const MINIMUM_LEXICAL_RANK = 0.05;
const RRF_CONSTANT = 60;
const SEMANTIC_WEIGHT = 0.7;
const LEXICAL_WEIGHT = 0.3;
const MAX_RESULTS_PER_FEED = 2;

export type SimilarItemsStatus = "pending" | "ready" | "unavailable";

export interface SimilarItemsResponse {
  count: number;
  hasMore: boolean;
  items: ItemResponse[];
  status: SimilarItemsStatus;
}

interface SourceFeatureRow {
  algorithm_version: string | null;
  embedding: string | null;
  feature_status: "ready" | "skipped" | null;
  feed_id: string;
  item_id: string;
  lexical_terms: string[] | null;
  published_at: Date | null;
  title: string | null;
  url: string | null;
}

interface CandidateRow extends ItemRow {
  lexical_rank?: number;
  semantic_similarity?: number;
}

interface RankedCandidate {
  item: ItemResponse;
  lexicalRank: number | null;
  lexicalPosition: number | null;
  score: number;
  semanticPosition: number | null;
  semanticSimilarity: number | null;
}

export async function listSimilarItems(
  pool: Pool,
  itemId: string,
  limit: number,
  enabled: boolean
): Promise<SimilarItemsResponse | null> {
  const source = await readSourceFeature(pool, itemId);

  if (!source) {
    return null;
  }

  if (!enabled || source.feature_status === "skipped") {
    return emptyResponse("unavailable");
  }

  if (
    source.feature_status !== "ready" ||
    source.algorithm_version !== SIMILARITY_ALGORITHM_VERSION ||
    !source.embedding
  ) {
    return emptyResponse("pending");
  }

  const [semanticRows, lexicalRows] = await Promise.all([
    listSemanticCandidates(pool, source),
    listLexicalCandidates(pool, source)
  ]);
  const ranked = rankCandidates(source, semanticRows, lexicalRows);
  const selected = diversifyCandidates(source, ranked, limit + 1);
  const hasMore = selected.length > limit;
  const items = selected.slice(0, limit).map((candidate) => candidate.item);

  return {
    count: items.length,
    hasMore,
    items,
    status: "ready"
  };
}

async function readSourceFeature(
  pool: Pool,
  itemId: string
): Promise<SourceFeatureRow | null> {
  const result = await pool.query<SourceFeatureRow>(
    `
      select
        items.id as item_id,
        items.feed_id,
        items.title,
        items.url,
        items.published_at,
        features.algorithm_version,
        features.status as feature_status,
        features.lexical_terms,
        features.embedding::text as embedding
      from items
      left join item_similarity_features as features
        on features.item_id = items.id
      where items.id = $1
    `,
    [itemId]
  );

  return result.rows[0] ?? null;
}

async function listSemanticCandidates(
  pool: Pool,
  source: SourceFeatureRow
): Promise<CandidateRow[]> {
  const result = await pool.query<CandidateRow>(
    `
      with nearest as materialized (
        select
          features.item_id,
          features.embedding <=> $1::halfvec as distance
        from item_similarity_features as features
        where features.status = 'ready'
          and features.algorithm_version = $2
          and features.item_id <> $3
        order by features.embedding <=> $1::halfvec
        limit $4
      )
      select
        items.id,
        items.feed_id,
        feeds.title as feed_title,
        items.title,
        items.url,
        items.author,
        items.summary_text,
        items.content_html,
        items.published_at,
        items.raw_extension_data,
        items.is_read,
        items.is_starred,
        items.created_at,
        1 - nearest.distance as semantic_similarity
      from nearest
      join items on items.id = nearest.item_id
      join feeds on feeds.id = items.feed_id
      where nearest.distance <= $5
      order by nearest.distance asc, items.id asc
    `,
    [
      source.embedding,
      SIMILARITY_ALGORITHM_VERSION,
      source.item_id,
      SEMANTIC_CANDIDATE_LIMIT,
      1 - MINIMUM_SEMANTIC_SIMILARITY
    ]
  );

  return result.rows;
}

async function listLexicalCandidates(
  pool: Pool,
  source: SourceFeatureRow
): Promise<CandidateRow[]> {
  const terms = source.lexical_terms ?? [];

  if (terms.length === 0) {
    return [];
  }

  const tsquery = terms.map(quoteTsqueryLexeme).join(" | ");
  const result = await pool.query<CandidateRow>(
    `
      select
        items.id,
        items.feed_id,
        feeds.title as feed_title,
        items.title,
        items.url,
        items.author,
        items.summary_text,
        items.content_html,
        items.published_at,
        items.raw_extension_data,
        items.is_read,
        items.is_starred,
        items.created_at,
        ts_rank_cd(
          features.search_document,
          to_tsquery('simple', $1),
          32
        ) as lexical_rank
      from item_similarity_features as features
      join items on items.id = features.item_id
      join feeds on feeds.id = items.feed_id
      where features.status = 'ready'
        and features.algorithm_version = $2
        and features.item_id <> $3
        and features.search_document @@ to_tsquery('simple', $1)
      order by lexical_rank desc, items.published_at desc nulls last, items.id desc
      limit $4
    `,
    [
      tsquery,
      SIMILARITY_ALGORITHM_VERSION,
      source.item_id,
      LEXICAL_CANDIDATE_LIMIT
    ]
  );

  return result.rows;
}

function rankCandidates(
  source: SourceFeatureRow,
  semanticRows: CandidateRow[],
  lexicalRows: CandidateRow[]
): RankedCandidate[] {
  const candidates = new Map<string, RankedCandidate>();

  semanticRows.forEach((row, index) => {
    candidates.set(row.id, {
      item: mapItem(row),
      lexicalPosition: null,
      lexicalRank: null,
      score: 0,
      semanticPosition: index + 1,
      semanticSimilarity: Number(row.semantic_similarity)
    });
  });

  lexicalRows.forEach((row, index) => {
    const existing = candidates.get(row.id);

    if (existing) {
      existing.lexicalPosition = index + 1;
      existing.lexicalRank = Number(row.lexical_rank);
      return;
    }

    candidates.set(row.id, {
      item: mapItem(row),
      lexicalPosition: index + 1,
      lexicalRank: Number(row.lexical_rank),
      score: 0,
      semanticPosition: null,
      semanticSimilarity: null
    });
  });

  for (const candidate of candidates.values()) {
    if (!qualifies(candidate)) {
      candidates.delete(candidate.item.id);
      continue;
    }

    const semanticScore =
      candidate.semanticPosition === null
        ? 0
        : SEMANTIC_WEIGHT / (RRF_CONSTANT + candidate.semanticPosition);
    const lexicalScore =
      candidate.lexicalPosition === null
        ? 0
        : LEXICAL_WEIGHT / (RRF_CONSTANT + candidate.lexicalPosition);
    const sameFeedMultiplier =
      candidate.item.feedId === source.feed_id ? 0.9 : 1;
    const recencyMultiplier = publicationRecencyMultiplier(
      source.published_at,
      candidate.item.publishedAt
    );

    candidate.score =
      (semanticScore + lexicalScore) * sameFeedMultiplier * recencyMultiplier;
  }

  return [...candidates.values()].sort(
    (left, right) =>
      right.score - left.score ||
      comparePublishedAt(right.item.publishedAt, left.item.publishedAt) ||
      right.item.id.localeCompare(left.item.id)
  );
}

function qualifies(candidate: RankedCandidate): boolean {
  if (
    candidate.semanticSimilarity !== null &&
    candidate.semanticSimilarity >= STRONG_SEMANTIC_SIMILARITY
  ) {
    return true;
  }

  if (
    candidate.semanticSimilarity !== null &&
    candidate.semanticSimilarity >= MINIMUM_SEMANTIC_SIMILARITY &&
    candidate.lexicalRank !== null
  ) {
    return true;
  }

  return (
    candidate.semanticSimilarity === null &&
    candidate.lexicalRank !== null &&
    candidate.lexicalRank >= MINIMUM_LEXICAL_RANK
  );
}

function diversifyCandidates(
  source: SourceFeatureRow,
  candidates: RankedCandidate[],
  limit: number
): RankedCandidate[] {
  const selected: RankedCandidate[] = [];
  const feedCounts = new Map<string, number>();
  const sourceCanonicalUrl = canonicalizeUrl(source.url);
  const canonicalUrls = new Set<string>(
    sourceCanonicalUrl ? [sourceCanonicalUrl] : []
  );

  for (const candidate of candidates) {
    if ((feedCounts.get(candidate.item.feedId) ?? 0) >= MAX_RESULTS_PER_FEED) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(candidate.item.url);

    if (canonicalUrl && canonicalUrls.has(canonicalUrl)) {
      continue;
    }

    if (areNearDuplicateTitles(source.title, candidate.item.title)) {
      continue;
    }

    if (
      selected.some((existing) =>
        areNearDuplicateTitles(existing.item.title, candidate.item.title)
      )
    ) {
      continue;
    }

    selected.push(candidate);
    feedCounts.set(
      candidate.item.feedId,
      (feedCounts.get(candidate.item.feedId) ?? 0) + 1
    );

    if (canonicalUrl) {
      canonicalUrls.add(canonicalUrl);
    }

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function quoteTsqueryLexeme(term: string): string {
  return `'${term.replace(/'/g, "''")}'`;
}

function publicationRecencyMultiplier(
  sourceDate: Date | null,
  candidateDate: string | null
): number {
  if (!sourceDate || !candidateDate) {
    return 1;
  }

  const differenceDays =
    Math.abs(sourceDate.getTime() - new Date(candidateDate).getTime()) /
    (24 * 60 * 60_000);

  return 1 + 0.05 / (1 + differenceDays / 30);
}

function comparePublishedAt(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  return left.localeCompare(right);
}

function canonicalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.href;
  } catch {
    return value.trim().toLocaleLowerCase() || null;
  }
}

function areNearDuplicateTitles(
  left: string | null,
  right: string | null
): boolean {
  const leftTokens = titleTokenSet(left);
  const rightTokens = titleTokenSet(right);

  if (leftTokens.size < 3 || rightTokens.size < 3) {
    return false;
  }

  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 && intersection / union >= 0.85;
}

function titleTokenSet(value: string | null): Set<string> {
  const tokens =
    value
      ?.normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];

  return new Set(tokens);
}

function emptyResponse(status: Exclude<SimilarItemsStatus, "ready">): SimilarItemsResponse {
  return {
    count: 0,
    hasMore: false,
    items: [],
    status
  };
}
