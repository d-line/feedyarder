import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool, PoolClient } from "pg";

const MIGRATIONS_TABLE = "schema_migrations";
const UP_MIGRATION_FILE_PATTERN = /^(\d{4})_(.+)\.up\.sql$/;

export interface Migration {
  downPath: string | null;
  fileBase: string;
  name: string;
  upPath: string;
  version: string;
}

export interface MigrationStatus {
  applied: Migration[];
  pending: Migration[];
}

export async function loadMigrations(): Promise<Migration[]> {
  const migrationsDir = resolveMigrationsDir();
  const fileNames = await readdir(migrationsDir);
  const fileNameSet = new Set(fileNames);
  const migrations: Migration[] = [];

  for (const fileName of fileNames) {
    const match = fileName.match(UP_MIGRATION_FILE_PATTERN);

    if (!match) {
      continue;
    }

    const version = match[1];
    const name = match[2];

    if (!version || !name) {
      continue;
    }
    const fileBase = `${version}_${name}`;
    const downFileName = `${fileBase}.down.sql`;

    migrations.push({
      downPath: fileNameSet.has(downFileName)
        ? path.resolve(migrationsDir, downFileName)
        : null,
      fileBase,
      name,
      upPath: path.resolve(migrationsDir, fileName),
      version
    });
  }

  return migrations.sort((left, right) => left.version.localeCompare(right.version));
}

export async function applyUpMigrations(
  pool: Pool,
  migrations: Migration[]
): Promise<number> {
  await ensureMigrationsTable(pool);
  const appliedVersions = await readAppliedVersions(pool);
  let appliedCount = 0;

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await runInTransaction(pool, async (client) => {
      const sql = await readFile(migration.upPath, "utf8");

      await client.query(sql);
      await client.query(
        `
          insert into schema_migrations (version, name)
          values ($1, $2)
        `,
        [migration.version, migration.name]
      );
    });

    appliedCount += 1;
    console.log(`Applied migration ${migration.fileBase}`);
  }

  return appliedCount;
}

export async function rollbackMigrations(
  pool: Pool,
  migrations: Migration[],
  steps: number
): Promise<number> {
  if (steps <= 0) {
    throw new Error("Rollback steps must be a positive integer.");
  }

  await ensureMigrationsTable(pool);
  const appliedRows = await pool.query<{ version: string }>(
    `
      select version
      from schema_migrations
      order by version desc
      limit $1
    `,
    [steps]
  );

  if (appliedRows.rows.length === 0) {
    return 0;
  }

  const migrationByVersion = new Map(
    migrations.map((migration) => [migration.version, migration])
  );
  let rolledBackCount = 0;

  for (const row of appliedRows.rows) {
    const migration = migrationByVersion.get(row.version);

    if (!migration) {
      throw new Error(
        `Cannot rollback migration version ${row.version}: migration file is missing.`
      );
    }

    if (!migration.downPath) {
      throw new Error(
        `Cannot rollback migration ${migration.fileBase}: down migration file is missing.`
      );
    }

    await runInTransaction(pool, async (client) => {
      const sql = await readFile(migration.downPath as string, "utf8");

      await client.query(sql);
      await client.query(
        `
          delete from schema_migrations
          where version = $1
        `,
        [migration.version]
      );
    });

    rolledBackCount += 1;
    console.log(`Rolled back migration ${migration.fileBase}`);
  }

  return rolledBackCount;
}

export async function readMigrationStatus(
  pool: Pool,
  migrations: Migration[]
): Promise<MigrationStatus> {
  await ensureMigrationsTable(pool);
  const appliedVersions = await readAppliedVersions(pool);
  const applied: Migration[] = [];
  const pending: Migration[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      applied.push(migration);
      continue;
    }

    pending.push(migration);
  }

  return {
    applied,
    pending
  };
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function readAppliedVersions(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>(
    `
      select version
      from schema_migrations
    `
  );

  return new Set(result.rows.map((row) => row.version));
}

async function runInTransaction(
  pool: Pool,
  action: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await action(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function resolveMigrationsDir(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);

  return path.resolve(currentDirPath, "../migrations");
}
