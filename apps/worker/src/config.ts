import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootEnvPath = path.resolve(currentDirPath, "../../../.env");

loadEnvFile({
  path: repoRootEnvPath
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  FETCH_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  FETCH_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional()
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function getConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return envSchema.parse(env);
}
