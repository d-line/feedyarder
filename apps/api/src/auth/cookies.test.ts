import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { clearSessionCookie, getSessionToken, setSessionCookie } from "./cookies.js";

describe("auth cookies", () => {
  const baseConfig = {
    API_HOST: "127.0.0.1",
    API_PORT: 3001,
    DATABASE_URL: "postgres://localhost/feedyarder",
    NODE_ENV: "test" as const,
    SESSION_COOKIE_NAME: "feedyarder_session",
    SESSION_COOKIE_SECURE: false,
    SESSION_MAX_AGE_DAYS: 30,
    WEB_ORIGIN: "http://localhost:3000"
  };

  it("reads session token from cookie header", () => {
    const token = getSessionToken(
      "foo=bar; feedyarder_session=session-token-123; theme=dark",
      "feedyarder_session"
    );

    expect(token).toBe("session-token-123");
  });

  it("returns undefined when cookie header is missing", () => {
    expect(getSessionToken(undefined, "feedyarder_session")).toBeUndefined();
  });

  it("sets secure session cookie attributes", () => {
    const response = createResponseMock();

    setSessionCookie(response, baseConfig, "session-token-abc");

    expect(response.setHeader).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("feedyarder_session=session-token-abc")
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("HttpOnly")
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("Max-Age=2592000")
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("SameSite=Lax")
    );
  });

  it("clears session cookie by setting max-age to zero", () => {
    const response = createResponseMock();

    clearSessionCookie(response, baseConfig);

    expect(response.setHeader).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("feedyarder_session=")
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("Max-Age=0")
    );
  });
});

function createResponseMock(): Response {
  return {
    setHeader: vi.fn()
  } as unknown as Response;
}
