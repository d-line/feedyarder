import type { Pool } from "pg";

import type { SimilarityWorkerConfig } from "./config.js";
import type { SimilarityEmbedder } from "./model.js";
import {
  claimSimilarityJobs,
  completeReadySimilarityJob,
  completeSkippedSimilarityJob,
  rescheduleSimilarityJob,
  type ClaimedSimilarityJob
} from "./repository.js";
import { prepareSimilarityText, type PreparedSimilarityText } from "./text.js";

interface PreparedJob {
  job: ClaimedSimilarityJob;
  text: PreparedSimilarityText;
}

export interface SimilarityCycleResult {
  claimedCount: number;
  failedCount: number;
  readyCount: number;
  skippedCount: number;
}

export async function runSimilarityCycle(
  pool: Pool,
  config: SimilarityWorkerConfig,
  embedder: SimilarityEmbedder
): Promise<SimilarityCycleResult> {
  const startedAt = Date.now();
  const jobs = await claimSimilarityJobs(
    pool,
    config.SIMILARITY_BATCH_SIZE,
    config.SIMILARITY_LEASE_MS
  );
  const result: SimilarityCycleResult = {
    claimedCount: jobs.length,
    failedCount: 0,
    readyCount: 0,
    skippedCount: 0
  };

  if (jobs.length === 0) {
    return result;
  }

  const preparedJobs: PreparedJob[] = [];

  for (const job of jobs) {
    const prepared = prepareSimilarityText({
      contentHtml: job.contentHtml,
      summaryText: job.summaryText,
      title: job.title
    });

    if (prepared.kind === "skipped") {
      try {
        const completed = await completeSkippedSimilarityJob(pool, job, {
          inputHash: prepared.inputHash,
          plainTextLength: prepared.plainTextLength,
          reason: prepared.reason
        });

        if (completed) {
          result.skippedCount += 1;
        }
      } catch (error) {
        result.failedCount += 1;
        await safelyReschedule(pool, job, error, "database");
      }

      continue;
    }

    preparedJobs.push({
      job,
      text: prepared.value
    });
  }

  if (preparedJobs.length > 0) {
    let embeddings: number[][];

    try {
      embeddings = await embedder.embed(
        preparedJobs.map((prepared) => prepared.text.modelText)
      );
    } catch (error) {
      result.failedCount += preparedJobs.length;

      await Promise.all(
        preparedJobs.map(({ job }) =>
          safelyReschedule(pool, job, error, "embedding")
        )
      );

      logCycle(result, startedAt);
      return result;
    }

    for (const [index, prepared] of preparedJobs.entries()) {
      const embedding = embeddings[index];

      if (!embedding) {
        result.failedCount += 1;
        await safelyReschedule(
          pool,
          prepared.job,
          new Error("Embedding batch omitted an item vector."),
          "embedding"
        );
        continue;
      }

      try {
        const completed = await completeReadySimilarityJob(pool, prepared.job, {
          bodyText: prepared.text.bodyText,
          embedding,
          inputHash: prepared.text.inputHash,
          lexicalTerms: prepared.text.lexicalTerms,
          plainTextLength: prepared.text.plainTextLength,
          summaryText: prepared.text.summaryText,
          titleText: prepared.text.titleText
        });

        if (completed) {
          result.readyCount += 1;
        }
      } catch (error) {
        result.failedCount += 1;
        await safelyReschedule(pool, prepared.job, error, "database");
      }
    }
  }

  logCycle(result, startedAt);
  return result;
}

async function safelyReschedule(
  pool: Pool,
  job: ClaimedSimilarityJob,
  error: unknown,
  category: string
): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown similarity failure";

  console.error("Similarity item failed", {
    attemptCount: job.attemptCount,
    errorCategory: category,
    errorMessage: message,
    itemId: job.itemId
  });

  try {
    await rescheduleSimilarityJob(pool, job, {
      errorCategory: category,
      errorMessage: message
    });
  } catch (rescheduleError) {
    console.error("Similarity item reschedule failed", {
      errorMessage:
        rescheduleError instanceof Error
          ? rescheduleError.message
          : "Unknown reschedule failure",
      itemId: job.itemId
    });
  }
}

function logCycle(result: SimilarityCycleResult, startedAt: number): void {
  console.log("Similarity cycle completed", {
    claimedCount: result.claimedCount,
    durationMs: Date.now() - startedAt,
    failedCount: result.failedCount,
    readyCount: result.readyCount,
    skippedCount: result.skippedCount
  });
}
