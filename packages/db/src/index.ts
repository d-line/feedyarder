import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString
    });
  }

  return pool;
}

export * from "./migrator.js";

export async function readMigrationFile(fileName: string): Promise<string> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);
  const migrationPath = path.resolve(currentDirPath, "../migrations", fileName);

  return readFile(migrationPath, "utf8");
}
