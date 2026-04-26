import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";

import { getPool } from "./index.js";
import {
  applyUpMigrations,
  loadMigrations,
  readMigrationStatus,
  rollbackMigrations
} from "./migrator.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootEnvPath = path.resolve(currentDirPath, "../../../.env");

loadEnvFile({
  path: repoRootEnvPath
});

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const command = process.argv[2] ?? "up";
  const stepsInput = process.argv[3];

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const pool = getPool(databaseUrl);
  const migrations = await loadMigrations();

  if (command === "up") {
    const appliedCount = await applyUpMigrations(pool, migrations);
    console.log(`Up migration complete. Applied ${appliedCount} migration(s).`);
    await pool.end();
    return;
  }

  if (command === "down") {
    const parsedSteps = Number.parseInt(stepsInput ?? "1", 10);

    if (Number.isNaN(parsedSteps) || parsedSteps <= 0) {
      throw new Error("Down migration requires a positive integer step count.");
    }

    const rolledBackCount = await rollbackMigrations(pool, migrations, parsedSteps);
    console.log(`Down migration complete. Rolled back ${rolledBackCount} migration(s).`);
    await pool.end();
    return;
  }

  if (command === "status") {
    const status = await readMigrationStatus(pool, migrations);
    console.log(`Applied migrations (${status.applied.length}):`);

    for (const migration of status.applied) {
      console.log(`  - ${migration.fileBase}`);
    }

    console.log(`Pending migrations (${status.pending.length}):`);

    for (const migration of status.pending) {
      console.log(`  - ${migration.fileBase}`);
    }

    await pool.end();
    return;
  }

  await pool.end();

  throw new Error(`Unknown migration command "${command}". Use: up, down, status.`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
