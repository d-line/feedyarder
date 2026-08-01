import { getPool } from "./db/pool.js";
import { getSimilarityWorkerConfig } from "./similarity/config.js";
import {
  enqueueMissingSimilarityJobs,
  readSimilarityQueueStatus
} from "./similarity/repository.js";

const config = getSimilarityWorkerConfig();
const pool = getPool(config.DATABASE_URL);

async function run(): Promise<void> {
  const command = process.argv[2];

  if (command === "status") {
    const status = await readSimilarityQueueStatus(pool);
    const covered = status.readyFeatures + status.skippedFeatures;
    const coverage =
      status.totalItems === 0 ? 100 : (covered / status.totalItems) * 100;

    console.log(
      JSON.stringify(
        {
          ...status,
          coveragePercent: Number(coverage.toFixed(2)),
          oldestPendingAt: status.oldestPendingAt?.toISOString() ?? null
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "enqueue") {
    const options = parseEnqueueOptions(process.argv.slice(3));
    let totalEnqueued = 0;

    while (true) {
      const enqueued = await enqueueMissingSimilarityJobs(pool, {
        limit: options.limit,
        newerThan: options.newerThan
      });
      totalEnqueued += enqueued;
      console.log(`Enqueued ${enqueued} similarity job(s); total=${totalEnqueued}`);

      if (!options.all || enqueued < options.limit) {
        break;
      }
    }

    return;
  }

  throw new Error("Use `status` or `enqueue [--all] [--limit N] [--newer-than ISO]`.");
}

function parseEnqueueOptions(args: string[]): {
  all: boolean;
  limit: number;
  newerThan: Date | null;
} {
  let all = false;
  let limit = 10_000;
  let newerThan: Date | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--all") {
      all = true;
      continue;
    }

    if (argument === "--limit") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);

      if (!Number.isInteger(value) || value <= 0 || value > 100_000) {
        throw new Error("--limit must be an integer from 1 through 100000.");
      }

      limit = value;
      index += 1;
      continue;
    }

    if (argument === "--newer-than") {
      const value = new Date(args[index + 1] ?? "");

      if (Number.isNaN(value.getTime())) {
        throw new Error("--newer-than must be a valid date.");
      }

      newerThan = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown similarity enqueue argument "${argument}".`);
  }

  return {
    all,
    limit,
    newerThan
  };
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
