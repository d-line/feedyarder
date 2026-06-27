import { describe, expect, it } from "vitest";

import { parseBackfillArguments } from "./args.js";

describe("parseBackfillArguments", () => {
  it("parses a feed id", () => {
    expect(parseBackfillArguments(["feed-id"])).toEqual({
      force: false,
      liquorSitemapFile: null,
      rutrackerStart: null,
      selection: { feedId: "feed-id", kind: "feed" }
    });
  });

  it("parses a folder title and named start offset", () => {
    expect(parseBackfillArguments(["--folder", "youtube", "--start", "150"])).toEqual({
      force: false,
      liquorSitemapFile: null,
      rutrackerStart: 150,
      selection: { folderReference: "youtube", kind: "folder" }
    });
  });

  it("supports a positional RuTracker start offset for a single feed", () => {
    expect(parseBackfillArguments(["feed-id", "50"])).toEqual({
      force: false,
      liquorSitemapFile: null,
      rutrackerStart: 50,
      selection: { feedId: "feed-id", kind: "feed" }
    });
  });

  it("parses a local Liquor.com sitemap file", () => {
    expect(
      parseBackfillArguments([
        "feed-id",
        "--sitemap-file",
        "/Users/example/Downloads/sitemap_1.xml"
      ])
    ).toEqual({
      force: false,
      liquorSitemapFile: "/Users/example/Downloads/sitemap_1.xml",
      rutrackerStart: null,
      selection: { feedId: "feed-id", kind: "feed" }
    });
  });

  it("parses force for feed and folder backfills", () => {
    expect(parseBackfillArguments(["feed-id", "--force"])).toEqual({
      force: true,
      liquorSitemapFile: null,
      rutrackerStart: null,
      selection: { feedId: "feed-id", kind: "feed" }
    });
    expect(parseBackfillArguments(["--folder", "youtube", "--force"])).toEqual({
      force: true,
      liquorSitemapFile: null,
      rutrackerStart: null,
      selection: { folderReference: "youtube", kind: "folder" }
    });
  });

  it.each(["-1", "1.5", "nope"])("rejects invalid start offset %s", (value) => {
    expect(() => parseBackfillArguments(["feed-id", "--start", value])).toThrow(
      "RuTracker start offset must be a non-negative integer"
    );
  });

  it("rejects combining feed and folder selections", () => {
    expect(() => parseBackfillArguments(["feed-id", "--folder", "youtube"])).toThrow(
      "Specify either a feed id or --folder"
    );
  });

  it("rejects a missing sitemap file path", () => {
    expect(() => parseBackfillArguments(["feed-id", "--sitemap-file"])).toThrow(
      "--sitemap-file requires a file path"
    );
  });
});
