import { z } from "zod";

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string()
      })
      .passthrough()
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const setupStatusResponseSchema = z
  .object({
    setupCompleted: z.boolean()
  })
  .strict();
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const userResponseSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    createdAt: z.string()
  })
  .strict();
export type User = z.infer<typeof userResponseSchema>;

export const folderResponseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    position: z.number().int(),
    createdAt: z.string()
  })
  .strict();
export const folderListResponseSchema = z.array(folderResponseSchema);
export type Folder = z.infer<typeof folderResponseSchema>;

export const feedResponseSchema = z
  .object({
    id: z.string(),
    folderId: z.string().nullable(),
    title: z.string().nullable(),
    siteUrl: z.string().nullable(),
    feedUrl: z.string(),
    faviconUrl: z.string().nullable(),
    status: z.string(),
    isPaused: z.boolean(),
    fetchIntervalMinutes: z.number().int(),
    consecutiveErrorCount: z.number().int(),
    lastSuccessAt: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    lastErrorCategory: z.string().nullable(),
    lastErrorMessage: z.string().nullable(),
    createdAt: z.string()
  })
  .strict();
export const feedListResponseSchema = z.array(feedResponseSchema);
export type Feed = z.infer<typeof feedResponseSchema>;

export const fetchEventResponseSchema = z
  .object({
    id: z.string(),
    feedId: z.string(),
    feedTitle: z.string().nullable(),
    feedUrl: z.string(),
    status: z.string(),
    errorCategory: z.string().nullable(),
    errorMessage: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    missingPublishedAtCount: z.number().int(),
    fetchedAt: z.string(),
    durationMs: z.number().int().nullable()
  })
  .strict();
export const fetchEventListResponseSchema = z.array(fetchEventResponseSchema);
export type FetchEvent = z.infer<typeof fetchEventResponseSchema>;

export const opmlImportResponseSchema = z
  .object({
    createdFeedCount: z.number().int(),
    createdFolderCount: z.number().int(),
    skippedFeedCount: z.number().int()
  })
  .strict();
export type OpmlImportResponse = z.infer<typeof opmlImportResponseSchema>;

export const itemResponseSchema = z
  .object({
    id: z.string(),
    feedId: z.string(),
    feedTitle: z.string().nullable(),
    title: z.string().nullable(),
    url: z.string().nullable(),
    author: z.string().nullable(),
    summaryText: z.string().nullable(),
    contentHtml: z.string().nullable(),
    publishedAt: z.string().nullable(),
    isRead: z.boolean(),
    isStarred: z.boolean(),
    createdAt: z.string()
  })
  .strict();
export type Item = z.infer<typeof itemResponseSchema>;

export const itemListResponseSchema = z
  .object({
    items: z.array(itemResponseSchema),
    nextCursor: z.string().nullable()
  })
  .strict();
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
