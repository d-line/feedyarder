import type { Pool, PoolClient } from "pg";

import { SIMILARITY_ALGORITHM_VERSION } from "./constants.js";

export interface ClaimedSimilarityJob {
  attemptCount: number;
  contentHtml: string | null;
  itemId: string;
  leaseToken: string;
  summaryText: string | null;
  targetAlgorithmVersion: string;
  title: string | null;
}

export interface ReadySimilarityFeature {
  bodyText: string;
  embedding: number[];
  inputHash: string;
  lexicalTerms: string[];
  plainTextLength: number;
  summaryText: string;
  titleText: string;
}

export interface SimilarityQueueStatus {
  leasedJobs: number;
  oldestPendingAt: Date | null;
  pendingJobs: number;
  readyFeatures: number;
  retryingJobs: number;
  skippedFeatures: number;
  totalItems: number;
}

interface ClaimedSimilarityJobRow {
  attempt_count: number;
  content_html: string | null;
  item_id: string;
  lease_token: string;
  summary_text: string | null;
  target_algorithm_version: string;
  title: string | null;
}

export async function claimSimilarityJobs(
  pool: Pool,
  limit: number,
  leaseMilliseconds: number
): Promise<ClaimedSimilarityJob[]> {
  const result = await pool.query<ClaimedSimilarityJobRow>(
    `
      with claimable as (
        select item_id
        from item_similarity_jobs
        where available_at <= now()
          and (
            lease_expires_at is null
            or lease_expires_at <= now()
          )
        order by
          priority desc,
          available_at asc,
          created_at asc,
          item_id asc
        for update skip locked
        limit $1
      ),
      claimed as (
        update item_similarity_jobs as jobs
        set
          attempt_count = jobs.attempt_count + 1,
          lease_expires_at = now() + ($2::integer * interval '1 millisecond'),
          lease_token = gen_random_uuid(),
          updated_at = now()
        from claimable
        where jobs.item_id = claimable.item_id
        returning
          jobs.item_id,
          jobs.target_algorithm_version,
          jobs.attempt_count,
          jobs.lease_token
      )
      select
        claimed.item_id,
        claimed.target_algorithm_version,
        claimed.attempt_count,
        claimed.lease_token,
        items.title,
        items.summary_text,
        items.content_html
      from claimed
      join items on items.id = claimed.item_id
      order by claimed.item_id
    `,
    [limit, leaseMilliseconds]
  );

  return result.rows.map((row) => ({
    attemptCount: row.attempt_count,
    contentHtml: row.content_html,
    itemId: row.item_id,
    leaseToken: row.lease_token,
    summaryText: row.summary_text,
    targetAlgorithmVersion: row.target_algorithm_version,
    title: row.title
  }));
}

export async function completeReadySimilarityJob(
  pool: Pool,
  job: ClaimedSimilarityJob,
  feature: ReadySimilarityFeature
): Promise<boolean> {
  return finishClaimedJob(pool, job, async (client) => {
    await client.query(
      `
        insert into item_similarity_features (
          item_id,
          algorithm_version,
          status,
          input_hash,
          plain_text_length,
          lexical_terms,
          search_document,
          embedding,
          skip_reason,
          generated_at
        )
        values (
          $1,
          $2,
          'ready',
          $3,
          $4,
          $5::text[],
          setweight(to_tsvector('simple', $6), 'A')
            || setweight(to_tsvector('simple', $7), 'B')
            || setweight(to_tsvector('simple', $8), 'D'),
          $9::halfvec,
          null,
          now()
        )
        on conflict (item_id) do update
        set
          algorithm_version = excluded.algorithm_version,
          status = excluded.status,
          input_hash = excluded.input_hash,
          plain_text_length = excluded.plain_text_length,
          lexical_terms = excluded.lexical_terms,
          search_document = excluded.search_document,
          embedding = excluded.embedding,
          skip_reason = excluded.skip_reason,
          generated_at = excluded.generated_at
      `,
      [
        job.itemId,
        job.targetAlgorithmVersion,
        feature.inputHash,
        feature.plainTextLength,
        feature.lexicalTerms,
        feature.titleText,
        feature.summaryText,
        feature.bodyText,
        serializeVector(feature.embedding)
      ]
    );
  });
}

export async function completeSkippedSimilarityJob(
  pool: Pool,
  job: ClaimedSimilarityJob,
  input: {
    inputHash: string;
    plainTextLength: number;
    reason: string;
  }
): Promise<boolean> {
  return finishClaimedJob(pool, job, async (client) => {
    await client.query(
      `
        insert into item_similarity_features (
          item_id,
          algorithm_version,
          status,
          input_hash,
          plain_text_length,
          lexical_terms,
          search_document,
          embedding,
          skip_reason,
          generated_at
        )
        values (
          $1,
          $2,
          'skipped',
          $3,
          $4,
          '{}',
          ''::tsvector,
          null,
          $5,
          now()
        )
        on conflict (item_id) do update
        set
          algorithm_version = excluded.algorithm_version,
          status = excluded.status,
          input_hash = excluded.input_hash,
          plain_text_length = excluded.plain_text_length,
          lexical_terms = excluded.lexical_terms,
          search_document = excluded.search_document,
          embedding = excluded.embedding,
          skip_reason = excluded.skip_reason,
          generated_at = excluded.generated_at
      `,
      [
        job.itemId,
        job.targetAlgorithmVersion,
        input.inputHash,
        input.plainTextLength,
        input.reason
      ]
    );
  });
}

export async function rescheduleSimilarityJob(
  pool: Pool,
  job: ClaimedSimilarityJob,
  input: {
    errorCategory: string;
    errorMessage: string;
  }
): Promise<boolean> {
  const delayMilliseconds = calculateSimilarityRetryDelayMilliseconds(
    job.attemptCount
  );
  const result = await pool.query(
    `
      update item_similarity_jobs
      set
        available_at = now() + ($3::integer * interval '1 millisecond'),
        lease_expires_at = null,
        lease_token = null,
        last_error_category = $4,
        last_error_message = $5,
        updated_at = now()
      where item_id = $1
        and lease_token = $2
    `,
    [
      job.itemId,
      job.leaseToken,
      delayMilliseconds,
      input.errorCategory,
      input.errorMessage.slice(0, 2_000)
    ]
  );

  return (result.rowCount ?? 0) > 0;
}

export function calculateSimilarityRetryDelayMilliseconds(
  attemptCount: number
): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 16));
  return Math.min(60_000 * 2 ** exponent, 24 * 60 * 60_000);
}

export async function enqueueMissingSimilarityJobs(
  pool: Pool,
  input: {
    limit: number;
    newerThan: Date | null;
  }
): Promise<number> {
  const result = await pool.query(
    `
      insert into item_similarity_jobs (
        item_id,
        target_algorithm_version,
        priority
      )
      select
        items.id,
        $1,
        0
      from items
      left join item_similarity_features as features
        on features.item_id = items.id
      left join item_similarity_jobs as jobs
        on jobs.item_id = items.id
      where jobs.item_id is null
        and (
          features.item_id is null
          or features.algorithm_version <> $1
        )
        and ($2::timestamptz is null or items.created_at >= $2)
      order by
        items.published_at desc nulls last,
        items.created_at desc,
        items.id desc
      limit $3
      on conflict (item_id) do nothing
    `,
    [SIMILARITY_ALGORITHM_VERSION, input.newerThan, input.limit]
  );

  return result.rowCount ?? 0;
}

export async function readSimilarityQueueStatus(
  pool: Pool
): Promise<SimilarityQueueStatus> {
  const result = await pool.query<{
    leased_jobs: number;
    oldest_pending_at: Date | null;
    pending_jobs: number;
    ready_features: number;
    retrying_jobs: number;
    skipped_features: number;
    total_items: number;
  }>(
    `
      select
        (select count(*)::integer from items) as total_items,
        (
          select count(*)::integer
          from item_similarity_features
          where algorithm_version = $1 and status = 'ready'
        ) as ready_features,
        (
          select count(*)::integer
          from item_similarity_features
          where algorithm_version = $1 and status = 'skipped'
        ) as skipped_features,
        (
          select count(*)::integer
          from item_similarity_jobs
        ) as pending_jobs,
        (
          select count(*)::integer
          from item_similarity_jobs
          where lease_expires_at > now()
        ) as leased_jobs,
        (
          select count(*)::integer
          from item_similarity_jobs
          where last_error_category is not null
        ) as retrying_jobs,
        (
          select min(created_at)
          from item_similarity_jobs
        ) as oldest_pending_at
    `,
    [SIMILARITY_ALGORITHM_VERSION]
  );
  const row = result.rows[0];

  return {
    leasedJobs: row?.leased_jobs ?? 0,
    oldestPendingAt: row?.oldest_pending_at ?? null,
    pendingJobs: row?.pending_jobs ?? 0,
    readyFeatures: row?.ready_features ?? 0,
    retryingJobs: row?.retrying_jobs ?? 0,
    skippedFeatures: row?.skipped_features ?? 0,
    totalItems: row?.total_items ?? 0
  };
}

async function finishClaimedJob(
  pool: Pool,
  job: ClaimedSimilarityJob,
  writeFeature: (client: PoolClient) => Promise<void>
): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const deleted = await client.query(
      `
        delete from item_similarity_jobs
        where item_id = $1
          and lease_token = $2
        returning item_id
      `,
      [job.itemId, job.leaseToken]
    );

    if ((deleted.rowCount ?? 0) === 0) {
      await client.query("rollback");
      return false;
    }

    await writeFeature(client);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function serializeVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
