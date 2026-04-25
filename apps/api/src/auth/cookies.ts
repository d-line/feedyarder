import { parse, serialize } from "cookie";
import type { Response } from "express";

import type { AppConfig } from "../config.js";

export function getSessionToken(
  cookieHeader: string | undefined,
  cookieName: string
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  return parse(cookieHeader)[cookieName];
}

export function setSessionCookie(
  response: Response,
  config: AppConfig,
  token: string
): void {
  response.setHeader(
    "Set-Cookie",
    serialize(config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: config.SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: config.SESSION_COOKIE_SECURE
    })
  );
}

export function clearSessionCookie(
  response: Response,
  config: AppConfig
): void {
  response.setHeader(
    "Set-Cookie",
    serialize(config.SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: config.SESSION_COOKIE_SECURE
    })
  );
}
