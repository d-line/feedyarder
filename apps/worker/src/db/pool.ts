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
