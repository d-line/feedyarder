/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: openapi/feedyarder.openapi.yaml via `npm run generate:api -w @feedyarder/contracts`

import { z } from "zod";

type ItemListResponse = {
  items: Array<ItemResponse>;
  nextCursor: string | null;
};
type ItemResponse = {
  id: string;
  feedId: string;
  feedTitle: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summaryText: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
};

const HealthResponse = z
  .object({ ok: z.boolean(), service: z.literal("api") })
  .strict();
const SetupStatusResponse = z.object({ setupCompleted: z.boolean() }).strict();
const SetupRequest = z
  .object({
    username: z.string().min(3).max(64),
    password: z.string().min(12).max(256),
  })
  .strict();
const UserResponse = z
  .object({
    id: z.string().uuid(),
    username: z.string(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const ErrorResponse = z
  .object({
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .passthrough(),
  })
  .strict();
const SessionRequest = z
  .object({ username: z.string(), password: z.string() })
  .strict();
const FolderResponse = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    position: z.number().int(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const UpdateFolderRequest = z
  .object({
    title: z.string().min(1).max(128),
    position: z.number().int().gte(0),
  })
  .partial()
  .strict();
const CreateFolderRequest = z
  .object({
    title: z.string().min(1).max(128),
    position: z.number().int().gte(0).optional(),
  })
  .strict();
const FeedResponse = z
  .object({
    id: z.string().uuid(),
    folderId: z.union([z.string(), z.null()]),
    title: z.union([z.string(), z.null()]),
    siteUrl: z.union([z.string(), z.null()]),
    feedUrl: z.string().url(),
    faviconUrl: z.union([z.string(), z.null()]),
    status: z.string(),
    isPaused: z.boolean(),
    fetchIntervalMinutes: z.number().int(),
    consecutiveErrorCount: z.number().int(),
    lastBackfilledAt: z.union([z.string(), z.null()]),
    lastSuccessAt: z.union([z.string(), z.null()]),
    lastErrorAt: z.union([z.string(), z.null()]),
    lastErrorCategory: z.union([z.string(), z.null()]),
    lastErrorMessage: z.union([z.string(), z.null()]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const CreateFeedRequest = z
  .object({
    feedUrl: z.string().url(),
    title: z.union([z.string(), z.null()]).optional(),
    siteUrl: z.union([z.string(), z.null()]).optional(),
    folderId: z.union([z.string(), z.null()]).optional(),
  })
  .strict();
const UpdateFeedRequest = z
  .object({
    feedUrl: z.string().url(),
    title: z.union([z.string(), z.null()]),
    siteUrl: z.union([z.string(), z.null()]),
    folderId: z.union([z.string(), z.null()]),
    isPaused: z.boolean(),
  })
  .partial()
  .strict();
const FetchEventResponse = z
  .object({
    id: z.string().uuid(),
    feedId: z.string().uuid(),
    feedTitle: z.union([z.string(), z.null()]),
    feedUrl: z.string().url(),
    status: z.string(),
    errorCategory: z.union([z.string(), z.null()]),
    errorMessage: z.union([z.string(), z.null()]),
    httpStatus: z.union([z.number(), z.null()]),
    missingPublishedAtCount: z.number().int(),
    fetchedAt: z.string().datetime({ offset: true }),
    durationMs: z.union([z.number(), z.null()]),
  })
  .strict();
const ImportOpmlRequest = z.object({ opml: z.string() }).strict();
const ImportOpmlResponse = z
  .object({
    createdFeedCount: z.number().int(),
    createdFolderCount: z.number().int(),
    skippedFeedCount: z.number().int(),
  })
  .strict();
const ItemResponse: z.ZodType<ItemResponse> = z
  .object({
    id: z.string().uuid(),
    feedId: z.string().uuid(),
    feedTitle: z.union([z.string(), z.null()]),
    title: z.union([z.string(), z.null()]),
    url: z.union([z.string(), z.null()]),
    author: z.union([z.string(), z.null()]),
    summaryText: z.union([z.string(), z.null()]),
    contentHtml: z.union([z.string(), z.null()]),
    publishedAt: z.union([z.string(), z.null()]),
    isRead: z.boolean(),
    isStarred: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const ItemListResponse: z.ZodType<ItemListResponse> = z
  .object({
    items: z.array(ItemResponse),
    nextCursor: z.union([z.string(), z.null()]),
  })
  .strict();
const UpdateItemStateRequest = z
  .object({ isRead: z.boolean(), isStarred: z.boolean() })
  .partial()
  .strict();

export const schemas = {
  HealthResponse,
  SetupStatusResponse,
  SetupRequest,
  UserResponse,
  ErrorResponse,
  SessionRequest,
  FolderResponse,
  UpdateFolderRequest,
  CreateFolderRequest,
  FeedResponse,
  CreateFeedRequest,
  UpdateFeedRequest,
  FetchEventResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
  ItemResponse,
  ItemListResponse,
  UpdateItemStateRequest,
};
