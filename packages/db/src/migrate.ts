import { getPool, readMigrationFile } from "./index.js";

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
