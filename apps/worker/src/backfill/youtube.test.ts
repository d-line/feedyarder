import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildYtDlpArgs,
  getIgnorableYtDlpFailureReason,
  normalizeYtDlpVideo,
  resolveYouTubeBackfillUrls
} from "./youtube.js";
import { parseFeedDocument } from "../fetch/normalize.js";

describe("resolveYouTubeBackfillUrls", () => {
  it("resolves YouTube XML channel feeds to videos and shorts tabs", () => {
    expect(
      resolveYouTubeBackfillUrls({
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
        id: "feed-id",
        lastBackfilledAt: null,
        siteUrl: null,
        title: null
      })
    ).toEqual([
      { tab: "videos", url: "https://www.youtube.com/channel/UC123/videos" },
      { tab: "shorts", url: "https://www.youtube.com/channel/UC123/shorts" }
    ]);
  });

  it("resolves handle pages to videos and shorts tabs", () => {
    expect(
      resolveYouTubeBackfillUrls({
        feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
        id: "feed-id",
        lastBackfilledAt: null,
        siteUrl: "https://www.youtube.com/@example",
        title: null
      })
    ).toEqual([
      { tab: "videos", url: "https://www.youtube.com/@example/videos" },
      { tab: "shorts", url: "https://www.youtube.com/@example/shorts" }
    ]);
  });
});

describe("normalizeYtDlpVideo", () => {
  it("stores full yt-dlp metadata in raw extension data", () => {
    const item = normalizeYtDlpVideo(
      {
        channel: "Example Channel",
        description: "Description",
        id: "abc123",
        timestamp: 1_700_000_000,
        title: "Example Video",
        webpage_url: "https://www.youtube.com/watch?v=abc123"
      },
      "videos",
      "feed-id"
    );

    expect(item).toMatchObject({
      author: "Example Channel",
      guid: "yt:video:abc123",
      publishedAt: "2023-11-14T22:13:20.000Z",
      rawExtensionData: {
        youtube: {
          metadata: {
            id: "abc123",
            title: "Example Video"
          },
          sourceTab: "videos",
          videoId: "abc123"
        }
      },
      summaryText: "Description",
      title: "Example Video",
      url: "https://www.youtube.com/watch?v=abc123"
    });
  });

  it("prefers release timestamp over upload timestamp", () => {
    const item = normalizeYtDlpVideo(
      {
        id: "abc123",
        release_timestamp: 1_800_000_000,
        timestamp: 1_700_000_000,
        title: "Example Video",
        upload_date: "20231114",
        webpage_url: "https://www.youtube.com/watch?v=abc123"
      },
      "videos",
      "feed-id"
    );

    expect(item?.publishedAt).toBe("2027-01-15T08:00:00.000Z");
  });

  it("skips member-only videos", () => {
    const item = normalizeYtDlpVideo(
      {
        availability: "subscriber_only",
        id: "abc123",
        timestamp: 1_700_000_000,
        title: "Example Video",
        webpage_url: "https://www.youtube.com/watch?v=abc123"
      },
      "videos",
      "feed-id"
    );

    expect(item).toBeNull();
  });

  it("does not skip public videos with subscriber or membership text", () => {
    const item = normalizeYtDlpVideo(
      {
        availability: "public",
        description: "Subscribe for updates. Channel membership links are in the description.",
        id: "sH9bgApMQbU",
        timestamp: 1_700_000_000,
        title: "Subscriber Q&A and membership notes",
        webpage_url: "https://www.youtube.com/watch?v=sH9bgApMQbU"
      },
      "videos",
      "feed-id"
    );

    expect(item).toMatchObject({
      guid: "yt:video:sH9bgApMQbU",
      title: "Subscriber Q&A and membership notes"
    });
  });

  it("matches YouTube Atom feed dedupe keys", () => {
    const feedId = "feed-id";
    const atom = parseFeedDocument(
      `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <title>Example Channel</title>
        <link rel="alternate" href="https://www.youtube.com/channel/UC123"/>
        <entry>
          <id>yt:video:abc123</id>
          <yt:videoId>abc123</yt:videoId>
          <yt:channelId>UC123</yt:channelId>
          <title>Example Video</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
          <author><name>Example Channel</name></author>
          <published>2023-11-14T22:13:20Z</published>
          <updated>2023-11-14T22:13:20Z</updated>
          <summary>Description</summary>
        </entry>
      </feed>`,
      feedId
    );
    const backfilled = normalizeYtDlpVideo(
      {
        channel: "Example Channel",
        description: "Description",
        id: "abc123",
        timestamp: 1_700_000_000,
        title: "Example Video",
        webpage_url: "https://www.youtube.com/watch?v=abc123"
      },
      "videos",
      feedId
    );

    expect(backfilled?.guid).toBe("yt:video:abc123");
    expect(backfilled?.dedupeKey).toBe(atom.items[0]?.dedupeKey);
  });
});

describe("buildYtDlpArgs", () => {
  it("passes cookies and JavaScript runtime options to yt-dlp", () => {
    const previousCookiesFile = process.env.YT_DLP_COOKIES_FILE;
    const previousJsRuntime = process.env.YT_DLP_JS_RUNTIME;
    const previousRemoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS;
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "feedyarder-ytdlp-"));
    const cookiesFile = path.join(tempDir, "cookies.txt");

    writeFileSync(cookiesFile, "# Netscape HTTP Cookie File\n");
    process.env.YT_DLP_COOKIES_FILE = cookiesFile;
    process.env.YT_DLP_JS_RUNTIME = "node:/usr/local/bin/node";
    process.env.YT_DLP_REMOTE_COMPONENTS = "ejs:npm,ejs:github";

    try {
      expect(buildYtDlpArgs("https://www.youtube.com/@example/videos")).toEqual([
        "--ignore-config",
        "--skip-download",
        "--dump-json",
        "--ignore-errors",
        "--ignore-no-formats-error",
        "--no-warnings",
        "--no-progress",
        "--cookies",
        cookiesFile,
        "--no-js-runtimes",
        "--js-runtimes",
        "node:/usr/local/bin/node",
        "--remote-components",
        "ejs:npm",
        "--remote-components",
        "ejs:github",
        "https://www.youtube.com/@example/videos"
      ]);
    } finally {
      process.env.YT_DLP_COOKIES_FILE = previousCookiesFile;
      process.env.YT_DLP_JS_RUNTIME = previousJsRuntime;
      process.env.YT_DLP_REMOTE_COMPONENTS = previousRemoteComponents;
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});

describe("getIgnorableYtDlpFailureReason", () => {
  it("ignores missing shorts tabs", () => {
    expect(
      getIgnorableYtDlpFailureReason(
        "https://www.youtube.com/channel/UCCBVCTuk6uJrN3iFV_3vurg/shorts",
        "ERROR: [youtube:tab] UCCBVCTuk6uJrN3iFV_3vurg: This channel does not have a shorts tab"
      )
    ).toBe("missing_shorts_tab");
  });

  it("does not ignore missing shorts tab text for non-shorts URLs", () => {
    expect(
      getIgnorableYtDlpFailureReason(
        "https://www.youtube.com/channel/UCCBVCTuk6uJrN3iFV_3vurg/videos",
        "ERROR: [youtube:tab] UCCBVCTuk6uJrN3iFV_3vurg: This channel does not have a shorts tab"
      )
    ).toBeNull();
  });
});
