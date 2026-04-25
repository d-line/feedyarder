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
  feedUrl: z.string().url(),
  folderId: z.string().uuid().nullable().optional(),
  siteUrl: z.string().url().nullable().optional(),
  title: z.string().trim().max(256).nullable().optional()
});

export const updateFeedRequestSchema = z
  .object({
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
      value.title !== undefined,
    {
      message: "At least one feed field must be provided."
    }
  );

export const listFetchEventsQuerySchema = z.object({
  feedId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20)
});
