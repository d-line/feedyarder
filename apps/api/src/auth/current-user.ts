import type { Request } from "express";
import type { Pool } from "pg";

import { getSessionToken } from "./cookies.js";
import { getCurrentUserBySessionToken, type PublicUser } from "./repository.js";

export async function readCurrentUser(
  pool: Pool,
  request: Request,
  cookieName: string
): Promise<PublicUser | null> {
  const sessionToken = getSessionToken(request.headers.cookie, cookieName);

  if (!sessionToken) {
    return null;
  }

  return getCurrentUserBySessionToken(pool, sessionToken);
}
