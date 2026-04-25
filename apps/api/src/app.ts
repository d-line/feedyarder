import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { clearSessionCookie, getSessionToken, setSessionCookie } from "./auth/cookies.js";
import {
  createSession,
  createUser,
  deleteSessionByToken,
  findUserByUsername,
  getCurrentUserBySessionToken,
  getUserCount
} from "./auth/repository.js";
import { hashPassword, verifyPassword } from "./auth/passwords.js";
import { sessionRequestSchema, setupRequestSchema } from "./auth/schemas.js";
import type { AppConfig } from "./config.js";
import { getPool } from "./db/pool.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string
): Response<ErrorResponse> {
  return response.status(status).json({
    error: {
      code,
      message
    }
  });
}

export function createApp(config: AppConfig) {
  const app = express();
  const pool = getPool(config.DATABASE_URL);

  app.use(express.json());

  app.get("/health", async (_request, response, next) => {
    try {
      await pool.query("select 1");

      response.json({
        service: "api",
        ok: true
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/setup", async (request, response, next) => {
    try {
      const payload = setupRequestSchema.parse(request.body);
      const userCount = await getUserCount(pool);

      if (userCount > 0) {
        return sendError(
          response,
          409,
          "setup_already_completed",
          "Initial user setup has already been completed."
        );
      }

      const passwordHash = await hashPassword(payload.password);
      const user = await createUser(pool, payload.username, passwordHash);
      const expiresAt = new Date(
        Date.now() + config.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
      );
      const sessionToken = await createSession(pool, user.id, expiresAt);

      setSessionCookie(response, config, sessionToken);

      return response.status(201).json(user);
    } catch (error) {
      next(error);
    }
  });

  app.post("/session", async (request, response, next) => {
    try {
      const payload = sessionRequestSchema.parse(request.body);
      const user = await findUserByUsername(pool, payload.username);

      if (!user) {
        return sendError(response, 401, "invalid_credentials", "Invalid username or password.");
      }

      const isValid = await verifyPassword(payload.password, user.password_hash);

      if (!isValid) {
        return sendError(response, 401, "invalid_credentials", "Invalid username or password.");
      }

      const expiresAt = new Date(
        Date.now() + config.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
      );
      const sessionToken = await createSession(pool, user.id, expiresAt);

      setSessionCookie(response, config, sessionToken);

      return response.json({
        id: user.id,
        username: user.username,
        createdAt: user.created_at.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/session", async (request, response, next) => {
    try {
      const sessionToken = getSessionToken(
        request.headers.cookie,
        config.SESSION_COOKIE_NAME
      );

      if (sessionToken) {
        await deleteSessionByToken(pool, sessionToken);
      }

      clearSessionCookie(response, config);
      return response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/me", async (request, response, next) => {
    try {
      const sessionToken = getSessionToken(
        request.headers.cookie,
        config.SESSION_COOKIE_NAME
      );

      if (!sessionToken) {
        return sendError(response, 401, "not_authenticated", "Authentication is required.");
      }

      const user = await getCurrentUserBySessionToken(pool, sessionToken);

      if (!user) {
        clearSessionCookie(response, config);

        return sendError(response, 401, "not_authenticated", "Authentication is required.");
      }

      return response.json(user);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return response.status(400).json({
        error: {
          code: "invalid_request",
          message: "Request validation failed.",
          details: error.flatten()
        }
      });
    }

    console.error(error);

    return response.status(500).json({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred."
      }
    });
  });

  return app;
}
