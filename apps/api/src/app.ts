import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";

import { clearSessionCookie, getSessionToken, setSessionCookie } from "./auth/cookies.js";
import { readCurrentUser } from "./auth/current-user.js";
import {
  createSession,
  createUser,
  deleteSessionByToken,
  findUserByUsername,
  getUserCount
} from "./auth/repository.js";
import { hashPassword, verifyPassword } from "./auth/passwords.js";
import { sessionRequestSchema, setupRequestSchema } from "./auth/schemas.js";
import type { AppConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import { discoverFeeds, FeedDiscoveryError } from "./feed-management/discovery.js";
import {
  createFeed,
  createFolder,
  deleteFolder,
  deleteFeed,
  listFetchEvents,
  listFeeds,
  listFolders,
  retryFeedNow,
  updateFolder,
  updateFeed
} from "./feed-management/repository.js";
import {
  createFeedRequestSchema,
  createFolderRequestSchema,
  discoverFeedsRequestSchema,
  idPathParamsSchema as feedManagementIdPathParamsSchema,
  listFetchEventsQuerySchema,
  listFeedsQuerySchema,
  updateFolderRequestSchema,
  updateFeedRequestSchema
} from "./feed-management/schemas.js";
import { listItems, updateItemState } from "./item-management/repository.js";
import {
  idPathParamsSchema as itemManagementIdPathParamsSchema,
  listItemsQuerySchema,
  updateItemStateSchema
} from "./item-management/schemas.js";
import { importFeedsFromOpml, listFeedsForOpmlExport } from "./opml/repository.js";
import { importOpmlRequestSchema } from "./opml/schemas.js";
import { buildOpmlDocument, parseOpmlDocument } from "./opml/service.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

interface DatabaseErrorLike {
  code?: string;
  constraint?: string;
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

function isDatabaseError(error: unknown): error is DatabaseErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function mapFeedMutationError(response: Response, error: unknown): Response | null {
  if (!isDatabaseError(error)) {
    return null;
  }

  if (error.code === "23505" && error.constraint === "feeds_feed_url_key") {
    return sendError(response, 409, "feed_already_exists", "Feed URL already exists.");
  }

  if (error.code === "23503" && error.constraint === "feeds_folder_id_fkey") {
    return sendError(response, 400, "folder_not_found", "Folder was not found.");
  }

  return null;
}

export function createApp(config: AppConfig) {
  const app = express();
  const pool = getPool(config.DATABASE_URL);

  app.use(
    cors({
      credentials: true,
      origin: config.WEB_ORIGIN
    })
  );
  app.use(express.json());

  async function requireUser(request: Request, response: Response): Promise<boolean> {
    const user = await readCurrentUser(pool, request, config.SESSION_COOKIE_NAME);

    if (!user) {
      sendError(response, 401, "not_authenticated", "Authentication is required.");
      return false;
    }

    return true;
  }

  app.get("/health", async (_request, response, next) => {
    try {
      await pool.query("select 1");

      response.json({
        ok: true,
        service: "api"
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/setup/status", async (_request, response, next) => {
    try {
      const userCount = await getUserCount(pool);

      return response.json({
        setupCompleted: userCount > 0
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
        createdAt: user.created_at.toISOString(),
        id: user.id,
        username: user.username
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
      const user = await readCurrentUser(pool, request, config.SESSION_COOKIE_NAME);

      if (!user) {
        clearSessionCookie(response, config);
        return sendError(response, 401, "not_authenticated", "Authentication is required.");
      }

      return response.json(user);
    } catch (error) {
      next(error);
    }
  });

  app.get("/folders", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      return response.json(await listFolders(pool));
    } catch (error) {
      next(error);
    }
  });

  app.post("/folders", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const payload = createFolderRequestSchema.parse(request.body);

      return response.status(201).json(
        await createFolder(pool, {
          position: payload.position ?? 0,
          title: payload.title
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.patch("/folders/:id", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = feedManagementIdPathParamsSchema.parse(request.params);
      const payload = updateFolderRequestSchema.parse(request.body);
      const updateInput: Parameters<typeof updateFolder>[2] = {};

      if (typeof payload.title === "string") {
        updateInput.title = payload.title;
      }

      if (typeof payload.position === "number") {
        updateInput.position = payload.position;
      }

      const folder = await updateFolder(pool, id, updateInput);

      if (!folder) {
        return sendError(response, 404, "folder_not_found", "Folder was not found.");
      }

      return response.json(folder);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/folders/:id", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = feedManagementIdPathParamsSchema.parse(request.params);
      const deleted = await deleteFolder(pool, id);

      if (!deleted) {
        return sendError(response, 404, "folder_not_found", "Folder was not found.");
      }

      return response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/feeds", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const query = listFeedsQuerySchema.parse(request.query);
      return response.json(
        await listFeeds(pool, {
          includeStatistics: query.includeStatistics
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/feeds/discover", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const payload = discoverFeedsRequestSchema.parse(request.body);
      return response.json(await discoverFeeds(payload.url));
    } catch (error) {
      if (error instanceof FeedDiscoveryError) {
        return sendError(response, error.status, error.code, error.message);
      }

      next(error);
    }
  });

  app.post("/feeds", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const payload = createFeedRequestSchema.parse(request.body);

      return response.status(201).json(
        await createFeed(pool, {
          authPassword: payload.authPassword ?? null,
          authUsername: payload.authUsername ?? null,
          feedUrl: payload.feedUrl,
          folderId: payload.folderId ?? null,
          siteUrl: payload.siteUrl ?? null,
          title: payload.title ?? null
        })
      );
    } catch (error) {
      const mappedErrorResponse = mapFeedMutationError(response, error);

      if (mappedErrorResponse) {
        return mappedErrorResponse;
      }

      next(error);
    }
  });

  app.patch("/feeds/:id", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = feedManagementIdPathParamsSchema.parse(request.params);
      const payload = updateFeedRequestSchema.parse(request.body);
      const updateInput: Parameters<typeof updateFeed>[2] = {};

      if (typeof payload.feedUrl === "string") {
        updateInput.feedUrl = payload.feedUrl;
      }

      if ("folderId" in payload) {
        updateInput.folderId = payload.folderId ?? null;
      }

      if (typeof payload.isPaused === "boolean") {
        updateInput.isPaused = payload.isPaused;
      }

      if ("siteUrl" in payload) {
        updateInput.siteUrl = payload.siteUrl ?? null;
      }

      if ("title" in payload) {
        updateInput.title = payload.title ?? null;
      }

      if (payload.clearAuth === true) {
        updateInput.clearAuth = true;
      }

      if (
        typeof payload.authUsername === "string" &&
        typeof payload.authPassword === "string"
      ) {
        updateInput.authUsername = payload.authUsername;
        updateInput.authPassword = payload.authPassword;
      }

      const feed = await updateFeed(pool, id, updateInput);

      if (!feed) {
        return sendError(response, 404, "feed_not_found", "Feed was not found.");
      }

      return response.json(feed);
    } catch (error) {
      const mappedErrorResponse = mapFeedMutationError(response, error);

      if (mappedErrorResponse) {
        return mappedErrorResponse;
      }

      next(error);
    }
  });

  app.delete("/feeds/:id", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = feedManagementIdPathParamsSchema.parse(request.params);
      const deleted = await deleteFeed(pool, id);

      if (!deleted) {
        return sendError(response, 404, "feed_not_found", "Feed was not found.");
      }

      return response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/feeds/:id/retry", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = feedManagementIdPathParamsSchema.parse(request.params);
      const feed = await retryFeedNow(pool, id);

      if (!feed) {
        return sendError(response, 404, "feed_not_found", "Feed was not found.");
      }

      return response.json(feed);
    } catch (error) {
      next(error);
    }
  });

  app.get("/fetch-events", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const query = listFetchEventsQuerySchema.parse(request.query);

      return response.json(
        await listFetchEvents(pool, {
          feedId: query.feedId ?? null,
          limit: query.limit
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/items", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const query = listItemsQuerySchema.parse(request.query);

      return response.json(
        await listItems(pool, {
          cursor: query.cursor ?? null,
          feedId: query.feedId ?? null,
          folderId: query.folderId ?? null,
          limit: query.limit,
          query: query.q ?? null,
          read: query.read ?? null,
          starred: query.starred ?? null
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/opml/import", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const payload = importOpmlRequestSchema.parse(request.body);
      const feeds = parseOpmlDocument(payload.opml);
      const result = await importFeedsFromOpml(pool, feeds);

      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/opml/export", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const feeds = await listFeedsForOpmlExport(pool);
      const opml = buildOpmlDocument(feeds);

      response.setHeader("Content-Type", "application/xml; charset=utf-8");
      response.setHeader("Content-Disposition", 'attachment; filename="feedyarder.opml"');

      return response.send(opml);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/items/:id/state", async (request, response, next) => {
    try {
      if (!(await requireUser(request, response))) {
        return;
      }

      const { id } = itemManagementIdPathParamsSchema.parse(request.params);
      const payload = updateItemStateSchema.parse(request.body);
      const item = await updateItemState(pool, id, {
        isRead: payload.isRead ?? null,
        isStarred: payload.isStarred ?? null
      });

      if (!item) {
        return sendError(response, 404, "item_not_found", "Item was not found.");
      }

      return response.json(item);
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

    if (isDatabaseError(error) && error.code === "22P02") {
      return response.status(400).json({
        error: {
          code: "invalid_request",
          message: "Request validation failed."
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
