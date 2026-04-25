import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { buildDedupeKey } from "../fetch/normalize.js";
import type { NormalizedItem } from "../fetch/types.js";
import type { FeedBackfillTarget } from "../repository.js";

export type YouTubeBackfillTab = "videos" | "shorts";

export interface YouTubeBackfillUrl {
  tab: YouTubeBackfillTab;
  url: string;
}

interface YtDlpVideo {
  availability?: string;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  description?: string;
  duration?: number;
  id?: string;
  original_url?: string;
  release_timestamp?: number;
  timestamp?: number;
  title?: string;
  upload_date?: string;
  uploader?: string;
  uploader_id?: string;
  webpage_url?: string;
}

const ytDlpBinary = process.env.YT_DLP_BIN ?? "yt-dlp";
const defaultCookiesFile = path.resolve(process.cwd(), "cookies.txt");

export function resolveYouTubeBackfillUrls(feed: FeedBackfillTarget): YouTubeBackfillUrl[] {
  const channelUrl = resolveYouTubeChannelUrl(feed);

  if (!channelUrl) {
    throw new Error(
      `Feed ${feed.id} does not point to a YouTube channel/feed URL that can be backfilled.`
    );
  }

  return [
    { tab: "videos", url: buildYouTubeTabUrl(channelUrl, "videos") },
    { tab: "shorts", url: buildYouTubeTabUrl(channelUrl, "shorts") }
  ];
}

export async function collectYouTubeBackfillItems(
  url: string,
  tab: YouTubeBackfillTab,
  feedId: string,
  timeoutMs: number
): Promise<NormalizedItem[]> {
  const videos = await runYtDlp(url, resolveYtDlpTimeoutMs(timeoutMs));
  const items = new Map<string, NormalizedItem>();
  let skippedCount = 0;

  for (const video of videos) {
    const item = normalizeYtDlpVideo(video, tab, feedId);

    if (item) {
      items.set(item.guid ?? item.dedupeKey, item);
    } else {
      skippedCount += 1;
    }
  }

  console.log(
    `Backfill YouTube normalized: tab=${tab} parsed=${videos.length} normalized=${items.size} skipped=${skippedCount}`
  );

  return Array.from(items.values());
}

export function normalizeYtDlpVideo(
  video: YtDlpVideo,
  tab: YouTubeBackfillTab,
  feedId: string
): NormalizedItem | null {
  if (!video.id) {
    return null;
  }

  if (isSubscriberOnlyVideo(video)) {
    console.log(
      `Backfill YouTube item skipped_subscriber_only | sourceId=${video.id} | title=${video.title ?? "null"} | availability=${video.availability ?? "unknown"}`
    );
    return null;
  }

  const url = video.webpage_url ?? video.original_url ?? `https://www.youtube.com/watch?v=${video.id}`;
  const guid = `youtube-video:${video.id}`;
  const title = normalizeText(video.title);
  const author = normalizeText(video.channel) ?? normalizeText(video.uploader);
  const summaryText = normalizeText(video.description);
  const publishedAt = parsePublishedAt(video);

  return {
    author,
    contentHtml: buildContentHtml(url, title, summaryText),
    dedupeKey: buildDedupeKey(feedId, guid, url, title, publishedAt),
    guid,
    publishedAt,
    rawExtensionData: {
      youtube: {
        metadata: video,
        sourceTab: tab,
        videoId: video.id
      }
    },
    summaryText,
    title,
    url
  };
}

async function runYtDlp(url: string, timeoutMs: number | null): Promise<YtDlpVideo[]> {
  const args = buildYtDlpArgs(url);
  console.log(`Backfill yt-dlp command: ${ytDlpBinary} ${redactYtDlpArgs(args).join(" ")}`);
  console.log(`Backfill yt-dlp starting: url=${url} timeoutMs=${timeoutMs ?? "none"}`);

  const child = spawn(
    ytDlpBinary,
    args,
    {
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const stderrChunks: string[] = [];
  const videos: YtDlpVideo[] = [];
  let timedOut = false;
  const timeout =
    timeoutMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          console.log(`Backfill yt-dlp timeout reached: url=${url} timeoutMs=${timeoutMs}`);
          child.kill("SIGTERM");
        }, timeoutMs);

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
    logYtDlpStderr(chunk);
  });

  const stdout = createInterface({
    crlfDelay: Infinity,
    input: child.stdout
  });

  stdout.on("line", (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    try {
      const video = JSON.parse(trimmed) as YtDlpVideo;
      videos.push(video);
      console.log(formatYtDlpParsedLine(video, videos.length));
    } catch {
      stderrChunks.push(`Failed to parse yt-dlp JSON line: ${trimmed.slice(0, 200)}`);
      console.log(`Backfill yt-dlp json_parse_error: ${trimmed.slice(0, 200)}`);
    }
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
    child.on("error", reject);
      child.on("close", (code, signal) => {
        resolve({ code, signal });
      });
    }
  );

  if (timeout) {
    clearTimeout(timeout);
  }
  console.log(
    `Backfill yt-dlp finished: url=${url} exitCode=${exit.code} signal=${exit.signal ?? "none"} parsed=${videos.length}`
  );

  if (timedOut) {
    throw new Error(
      `yt-dlp timed out for ${url} after ${timeoutMs}ms after parsing ${videos.length} items. Increase YT_DLP_TIMEOUT_MS if this channel is large.`
    );
  }

  if (exit.code !== 0) {
    const stderr = stderrChunks.join("").trim();

    if (isIgnorableSubscriberOnlyFailure(stderr)) {
      console.log(`Backfill yt-dlp skipped subscriber-only failures for ${url}`);
      return videos;
    }

    throw new Error(
      `yt-dlp failed for ${url} with exit code ${exit.code} signal=${exit.signal ?? "none"}${stderr ? `: ${stderr}` : "."}`
    );
  }

  return videos;
}

function resolveYtDlpTimeoutMs(_fallbackTimeoutMs: number): number | null {
  const configured = process.env.YT_DLP_TIMEOUT_MS?.trim();

  if (configured) {
    const parsed = Number(configured);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`YT_DLP_TIMEOUT_MS must be a positive number of milliseconds, got: ${configured}`);
    }

    return parsed;
  }

  return null;
}

function formatYtDlpParsedLine(video: YtDlpVideo, count: number): string {
  return [
    `Backfill yt-dlp item parsed #${count}`,
    `sourceId=${video.id ?? "unknown"}`,
    `publishedAt=${parsePublishedAt(video) ?? "null"}`,
    `uploadDate=${video.upload_date ?? "null"}`,
    `timestamp=${video.timestamp ?? "null"}`,
    `releaseTimestamp=${video.release_timestamp ?? "null"}`,
    `availability=${video.availability ?? "unknown"}`,
    `title=${video.title ?? "null"}`
  ].join(" | ");
}

function logYtDlpStderr(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed) {
      console.log(`Backfill yt-dlp stderr: ${trimmed}`);
    }
  }
}

export function buildYtDlpArgs(url: string): string[] {
  const args = [
    "--skip-download",
    "--dump-json",
    "--ignore-errors",
    "--no-warnings",
    "--no-progress",
    url
  ];
  const cookiesFile = resolveCookiesFile();

  if (cookiesFile) {
    args.splice(args.length - 1, 0, "--cookies", cookiesFile);
  }

  if (process.env.YT_DLP_JS_RUNTIME) {
    args.splice(args.length - 1, 0, "--no-js-runtimes", "--js-runtimes", process.env.YT_DLP_JS_RUNTIME);
  }

  for (const component of parseCsvEnv("YT_DLP_REMOTE_COMPONENTS")) {
    args.splice(args.length - 1, 0, "--remote-components", component);
  }

  return args;
}

function resolveCookiesFile(): string | null {
  const configured = process.env.YT_DLP_COOKIES_FILE?.trim();

  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`YT_DLP_COOKIES_FILE points to a missing file: ${configured}`);
    }

    return configured;
  }

  return existsSync(defaultCookiesFile) ? defaultCookiesFile : null;
}

function redactYtDlpArgs(args: string[]): string[] {
  const redacted = [...args];

  for (let index = 0; index < redacted.length; index += 1) {
    if (redacted[index] === "--cookies" && redacted[index + 1]) {
      redacted[index + 1] = "<cookies.txt>";
    }
  }

  return redacted;
}

function parseCsvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveYouTubeChannelUrl(feed: FeedBackfillTarget): URL | null {
  for (const candidate of [feed.siteUrl, feed.feedUrl]) {
    if (!candidate) {
      continue;
    }

    const url = parseUrl(candidate);

    if (!url || !url.hostname.includes("youtube.com")) {
      continue;
    }

    const fromFeed = resolveYouTubeXmlFeedUrl(url);

    if (fromFeed) {
      return fromFeed;
    }

    const fromChannelUrl = resolveYouTubeWatchOrChannelUrl(url);

    if (fromChannelUrl) {
      return fromChannelUrl;
    }
  }

  return null;
}

function resolveYouTubeXmlFeedUrl(url: URL): URL | null {
  if (!url.pathname.endsWith("/feeds/videos.xml")) {
    return null;
  }

  const channelId = url.searchParams.get("channel_id");

  if (channelId) {
    return new URL(`/channel/${channelId}`, "https://www.youtube.com");
  }

  const user = url.searchParams.get("user");

  if (user) {
    return new URL(`/user/${user}`, "https://www.youtube.com");
  }

  return null;
}

function resolveYouTubeWatchOrChannelUrl(url: URL): URL | null {
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const first = parts[0] as string;

  if (first.startsWith("@")) {
    return new URL(`/${first}`, "https://www.youtube.com");
  }

  if ((first === "channel" || first === "c" || first === "user") && parts[1]) {
    return new URL(`/${first}/${parts[1]}`, "https://www.youtube.com");
  }

  return null;
}

function buildYouTubeTabUrl(channelUrl: URL, tab: YouTubeBackfillTab): string {
  const url = new URL(channelUrl.toString());
  const parts = url.pathname.split("/").filter(Boolean);
  const baseParts = parts.filter((part) => part !== "videos" && part !== "shorts");

  url.pathname = `/${baseParts.join("/")}/${tab}`;
  url.search = "";

  return url.toString();
}

function parsePublishedAt(video: YtDlpVideo): string | null {
  const timestamp = video.release_timestamp ?? video.timestamp;

  if (timestamp !== undefined) {
    const date = new Date(timestamp * 1000);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  if (video.upload_date && /^\d{8}$/.test(video.upload_date)) {
    const year = video.upload_date.slice(0, 4);
    const month = video.upload_date.slice(4, 6);
    const day = video.upload_date.slice(6, 8);
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function isSubscriberOnlyVideo(video: YtDlpVideo): boolean {
  const availability = video.availability?.toLowerCase() ?? "";
  const title = video.title?.toLowerCase() ?? "";
  const description = video.description?.toLowerCase() ?? "";

  return [availability, title, description].some(
    (value) =>
      value.includes("subscriber") ||
      value.includes("member-only") ||
      value.includes("members only") ||
      value.includes("membership")
  );
}

function isIgnorableSubscriberOnlyFailure(stderr: string): boolean {
  const normalized = stderr.toLowerCase();

  return (
    normalized.includes("subscriber") ||
    normalized.includes("member-only") ||
    normalized.includes("members only") ||
    normalized.includes("membership")
  );
}

function buildContentHtml(
  url: string,
  title: string | null,
  description: string | null
): string {
  const lines = [`<p><a href="${escapeHtml(url)}">${escapeHtml(title ?? "Open video on YouTube")}</a></p>`];

  if (description) {
    lines.push(`<p>${escapeHtml(description).replaceAll("\n", "<br>")}</p>`);
  }

  return lines.join("\n");
}

function normalizeText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
