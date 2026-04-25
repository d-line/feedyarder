import { z } from "zod";

export const setupRequestSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(12).max(256)
});

export const sessionRequestSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
