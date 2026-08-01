import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootPath = path.resolve(currentDirPath, "../../../..");

loadEnvFile({
  path: path.resolve(repoRootPath, ".env")
});

const booleanStringSchema = z.preprocess(
  (value) => {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    return value === undefined ? undefined : String(value).toLowerCase();
  },
  z.enum(["true", "false"]).transform((value) => value === "true")
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SIMILARITY_ALLOW_REMOTE_MODELS: booleanStringSchema.default(true),
  SIMILARITY_BATCH_SIZE: z.coerce.number().int().positive().max(64).default(8),
  SIMILARITY_ENABLED: booleanStringSchema.default(true),
  SIMILARITY_LEASE_MS: z.coerce.number().int().positive().default(15 * 60_000),
  SIMILARITY_MODEL_CACHE_DIR: z
    .string()
    .min(1)
    .default(path.resolve(repoRootPath, ".cache/similarity-models")),
  SIMILARITY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000)
});

export type SimilarityWorkerConfig = z.infer<typeof envSchema>;

export function getSimilarityWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): SimilarityWorkerConfig {
  return envSchema.parse(env);
}
