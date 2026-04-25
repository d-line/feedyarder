import { randomBytes } from "node:crypto";

import type { Pool } from "pg";

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

function mapUser(record: UserRecord): PublicUser {
  return {
    id: record.id,
    username: record.username,
    createdAt: record.created_at.toISOString()
  };
}

export async function getUserCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>("select count(*)::text as count from users");
  return Number(result.rows[0]?.count ?? 0);
}

export async function createUser(
  pool: Pool,
  username: string,
  passwordHash: string
): Promise<PublicUser> {
  const result = await pool.query<UserRecord>(
    `
      insert into users (username, password_hash)
      values ($1, $2)
      returning id, username, password_hash, created_at
    `,
    [username, passwordHash]
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error("User creation returned no row");
  }

  return mapUser(user);
}

export async function findUserByUsername(
  pool: Pool,
  username: string
): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    `
      select id, username, password_hash, created_at
      from users
      where username = $1
      limit 1
    `,
    [username]
  );

  return result.rows[0] ?? null;
}

export async function createSession(
  pool: Pool,
  userId: string,
  expiresAt: Date
): Promise<string> {
  const sessionToken = randomBytes(32).toString("hex");

  await pool.query(
    `
      insert into sessions (user_id, session_token, expires_at)
      values ($1, $2, $3)
    `,
    [userId, sessionToken, expiresAt]
  );

  return sessionToken;
}

export async function getCurrentUserBySessionToken(
  pool: Pool,
  sessionToken: string
): Promise<PublicUser | null> {
  const result = await pool.query<UserRecord>(
    `
      select u.id, u.username, u.password_hash, u.created_at
      from sessions s
      join users u on u.id = s.user_id
      where s.session_token = $1
        and s.expires_at > now()
      limit 1
    `,
    [sessionToken]
  );

  const user = result.rows[0];
  return user ? mapUser(user) : null;
}

export async function deleteSessionByToken(
  pool: Pool,
  sessionToken: string
): Promise<void> {
  await pool.query("delete from sessions where session_token = $1", [sessionToken]);
}
