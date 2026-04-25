import { z } from "zod";

export const importOpmlRequestSchema = z.object({
  opml: z.string().min(1)
});
