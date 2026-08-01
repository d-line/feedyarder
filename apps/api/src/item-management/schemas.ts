import { z } from "zod";

export const listItemsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  feedId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(100),
  q: z.string().trim().min(1).optional(),
  read: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  starred: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
});

export const listSimilarItemsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5)
});

export const updateItemStateSchema = z
  .object({
    isRead: z.boolean().optional(),
    isStarred: z.boolean().optional()
  })
  .refine((value) => value.isRead !== undefined || value.isStarred !== undefined, {
    message: "At least one state field must be provided."
  });

export const idPathParamsSchema = z.object({
  id: z.string().uuid()
});
