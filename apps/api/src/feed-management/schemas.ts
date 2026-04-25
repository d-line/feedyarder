import { z } from "zod";

export const createFolderRequestSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(128)
});

export const createFeedRequestSchema = z.object({
  feedUrl: z.string().url(),
  folderId: z.string().uuid().nullable().optional(),
  siteUrl: z.string().url().nullable().optional(),
  title: z.string().trim().max(256).nullable().optional()
});
