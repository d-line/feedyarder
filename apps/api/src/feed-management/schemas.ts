import { z } from "zod";

export const createFolderRequestSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(128)
});

export const updateFolderRequestSchema = z
  .object({
    position: z.number().int().nonnegative().optional(),
    title: z.string().trim().min(1).max(128).optional()
  })
  .refine((value) => value.position !== undefined || value.title !== undefined, {
    message: "At least one folder field must be provided."
  });

export const createFeedRequestSchema = z.object({
  authPassword: z.string().min(1).max(1024).optional(),
  authUsername: z.string().trim().min(1).max(256).optional(),
  feedUrl: z.string().url(),
  folderId: z.string().uuid().nullable().optional(),
  siteUrl: z.string().url().nullable().optional(),
  title: z.string().trim().max(256).nullable().optional()
}).refine(
  (value) =>
    (value.authUsername === undefined && value.authPassword === undefined) ||
    (value.authUsername !== undefined && value.authPassword !== undefined),
  {
    message: "Feed auth username and password must be provided together."
  }
);

export const discoverFeedsRequestSchema = z.object({
  url: z.string().url()
});

export const listFeedsQuerySchema = z.object({
  includeStatistics: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
});

export const updateFeedRequestSchema = z
  .object({
    authPassword: z.string().min(1).max(1024).optional(),
    authUsername: z.string().trim().min(1).max(256).optional(),
    clearAuth: z.boolean().optional(),
    feedUrl: z.string().url().optional(),
    folderId: z.string().uuid().nullable().optional(),
    isPaused: z.boolean().optional(),
    siteUrl: z.string().url().nullable().optional(),
    title: z.string().trim().max(256).nullable().optional()
  })
  .refine(
    (value) =>
      value.feedUrl !== undefined ||
      value.folderId !== undefined ||
      value.isPaused !== undefined ||
      value.siteUrl !== undefined ||
      value.title !== undefined ||
      value.authUsername !== undefined ||
      value.authPassword !== undefined ||
      value.clearAuth === true,
    {
      message: "At least one feed field must be provided."
    }
  )
  .refine(
    (value) =>
      (value.authUsername === undefined && value.authPassword === undefined) ||
      (value.authUsername !== undefined && value.authPassword !== undefined),
    {
      message: "Feed auth username and password must be provided together."
    }
  )
  .refine(
    (value) =>
      value.clearAuth !== true ||
      (value.authUsername === undefined && value.authPassword === undefined),
    {
      message: "Feed auth credentials cannot be set and cleared in the same request."
    }
  );

export const listFetchEventsQuerySchema = z.object({
  feedId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const idPathParamsSchema = z.object({
  id: z.string().uuid()
});
