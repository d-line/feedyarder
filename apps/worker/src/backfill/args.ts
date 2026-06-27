export type BackfillSelection =
  | { kind: "feed"; feedId: string }
  | { folderReference: string; kind: "folder" };

export interface BackfillArguments {
  force: boolean;
  liquorSitemapFile: string | null;
  rutrackerStart: number | null;
  selection: BackfillSelection;
}

const usage = [
  "Usage:",
  "  npm run backfill -- <feed-id> [--force] [--start <offset>] [--sitemap-file <path>]",
  "  npm run backfill -- <feed-id> [start-offset] [--force]",
  "  npm run backfill -- --folder <folder-id-or-title> [--force] [--start <offset>] [--sitemap-file <path>]"
].join("\n");

export function parseBackfillArguments(args: string[]): BackfillArguments {
  if (args.length === 0) {
    throw new Error(usage);
  }

  let selection: BackfillSelection | null = null;
  let force = false;
  let rutrackerStart: number | null = null;
  let liquorSitemapFile: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === undefined) {
      continue;
    }

    if (argument === "--folder") {
      if (selection) {
        throw new Error(`Specify either a feed id or --folder, not both.\n${usage}`);
      }

      const folderReference = args[index + 1]?.trim();

      if (!folderReference || folderReference.startsWith("--")) {
        throw new Error(`--folder requires a folder id or exact title.\n${usage}`);
      }

      selection = { folderReference, kind: "folder" };
      index += 1;
      continue;
    }

    if (argument === "--force") {
      force = true;
      continue;
    }

    if (argument === "--start") {
      const value = args[index + 1];

      if (value === undefined) {
        throw new Error(`--start requires a non-negative integer.\n${usage}`);
      }

      rutrackerStart = parseStartOffset(value);
      index += 1;
      continue;
    }

    if (argument === "--sitemap-file") {
      const value = args[index + 1]?.trim();

      if (!value || value.startsWith("--")) {
        throw new Error(`--sitemap-file requires a file path.\n${usage}`);
      }

      liquorSitemapFile = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown backfill option: ${argument}\n${usage}`);
    }

    if (!selection) {
      selection = { feedId: argument, kind: "feed" };
      continue;
    }

    if (selection.kind === "feed" && rutrackerStart === null) {
      rutrackerStart = parseStartOffset(argument);
      continue;
    }

    throw new Error(`Unexpected backfill argument: ${argument}\n${usage}`);
  }

  if (!selection) {
    throw new Error(usage);
  }

  return { force, liquorSitemapFile, rutrackerStart, selection };
}

function parseStartOffset(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`RuTracker start offset must be a non-negative integer, got: ${value}`);
  }

  return parsed;
}
