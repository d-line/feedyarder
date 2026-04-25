import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";

import { getPool, readMigrationFile } from "./index.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootEnvPath = path.resolve(currentDirPath, "../../../.env");

loadEnvFile({
  path: repoRootEnvPath
});

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const sql = await readMigrationFile("0001_initial.sql");
  const pool = getPool(databaseUrl);

  await pool.query(sql);
  await pool.end();

  console.log("Applied migration 0001_initial.sql");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
