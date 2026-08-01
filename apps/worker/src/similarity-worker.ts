import { getPool } from "./db/pool.js";
import { getSimilarityWorkerConfig } from "./similarity/config.js";
import {
  SIMILARITY_ALGORITHM_VERSION,
  SIMILARITY_MODEL_ID,
  SIMILARITY_MODEL_REVISION
} from "./similarity/constants.js";
import { LocalSimilarityEmbedder } from "./similarity/model.js";
import { runSimilarityCycle } from "./similarity/runner.js";

const config = getSimilarityWorkerConfig();
const pool = getPool(config.DATABASE_URL);
const embedder = new LocalSimilarityEmbedder({
  allowRemoteModels: config.SIMILARITY_ALLOW_REMOTE_MODELS,
  cacheDirectory: config.SIMILARITY_MODEL_CACHE_DIR
});
let shouldStop = false;

process.on("SIGINT", () => {
  shouldStop = true;
});
process.on("SIGTERM", () => {
  shouldStop = true;
});

async function run(): Promise<void> {
  console.log("Similarity worker bootstrap", {
    batchSize: config.SIMILARITY_BATCH_SIZE,
    enabled: config.SIMILARITY_ENABLED,
    algorithmVersion: SIMILARITY_ALGORITHM_VERSION,
    modelId: SIMILARITY_MODEL_ID,
    modelRevision: SIMILARITY_MODEL_REVISION,
    modelCacheDirectory: config.SIMILARITY_MODEL_CACHE_DIR,
    remoteModelsAllowed: config.SIMILARITY_ALLOW_REMOTE_MODELS
  });

  if (config.SIMILARITY_ENABLED) {
    await embedder.initialize();
  }

  while (!shouldStop) {
    if (config.SIMILARITY_ENABLED) {
      try {
        await runSimilarityCycle(pool, config, embedder);
      } catch (error) {
        console.error(
          "Similarity cycle failed",
          error instanceof Error ? error.message : error
        );
      }
    }

    await wait(config.SIMILARITY_POLL_INTERVAL_MS);
  }

  await pool.end();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

run().catch((error: unknown) => {
  console.error("Similarity worker failed", error);
  process.exitCode = 1;
});
