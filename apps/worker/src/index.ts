import { getConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import { runWorkerCycle } from "./runner.js";

const config = getConfig();
const pool = getPool(config.DATABASE_URL);

async function run(): Promise<void> {
  console.log("Worker bootstrap started");

  await runWorkerCycle(pool, config);

  setInterval(() => {
    void runWorkerCycle(pool, config).catch((error: unknown) => {
      console.error("Worker cycle failed", error);
    });
  }, config.WORKER_POLL_INTERVAL_MS);
}

run().catch((error: unknown) => {
  console.error("Worker bootstrap failed", error);
  process.exitCode = 1;
});
