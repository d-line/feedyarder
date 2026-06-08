import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import puppeteer, { type Browser, type Page } from "puppeteer-core";

export interface LiquorBrowserSession {
  close(): Promise<void>;
  fetchHtml(url: string, timeoutMs: number): Promise<string>;
}

const defaultChallengeTimeoutMs = 120_000;
const chromeExecutableCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

export async function createLiquorBrowserSession(
  env: NodeJS.ProcessEnv = process.env
): Promise<LiquorBrowserSession> {
  const debugUrl = env.LIQUOR_BROWSER_DEBUG_URL?.trim();
  const challengeTimeoutMs = parsePositiveIntegerEnv(
    env.LIQUOR_BROWSER_CHALLENGE_TIMEOUT_MS,
    defaultChallengeTimeoutMs,
    "LIQUOR_BROWSER_CHALLENGE_TIMEOUT_MS"
  );

  if (debugUrl) {
    const browser = await puppeteer.connect({
      browserURL: debugUrl,
      defaultViewport: null
    });
    const pages = await browser.pages();
    const page =
      pages.find((candidate) => candidate.url().includes("liquor.com")) ??
      pages[0] ??
      await browser.newPage();

    page.setDefaultNavigationTimeout(challengeTimeoutMs);
    page.setDefaultTimeout(challengeTimeoutMs);
    return buildSession(browser, page, challengeTimeoutMs, false);
  }

  const executablePath = await resolveChromeExecutablePath(env);
  const userDataDir = path.resolve(
    env.LIQUOR_BROWSER_USER_DATA_DIR?.trim() ||
      path.join(".feedyarder", "liquor-chrome-profile")
  );
  const headless = parseBooleanEnv(env.LIQUOR_BROWSER_HEADLESS, false);

  await mkdir(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    args: ["--disable-blink-features=AutomationControlled"],
    defaultViewport: null,
    executablePath,
    headless,
    userDataDir
  });
  const pages = await browser.pages();
  const page = pages[0] ?? await browser.newPage();

  page.setDefaultNavigationTimeout(challengeTimeoutMs);
  page.setDefaultTimeout(challengeTimeoutMs);

  return buildSession(browser, page, challengeTimeoutMs, true);
}

function buildSession(
  browser: Browser,
  page: Page,
  challengeTimeoutMs: number,
  ownsBrowser: boolean
): LiquorBrowserSession {
  return {
    async close(): Promise<void> {
      if (ownsBrowser) {
        await browser.close();
      } else {
        browser.disconnect();
      }
    },

    async fetchHtml(url: string, timeoutMs: number): Promise<string> {
      const navigationTimeoutMs = Math.max(timeoutMs, challengeTimeoutMs);
      const response = await page.goto(url, {
        timeout: navigationTimeoutMs,
        waitUntil: "domcontentloaded"
      });

      if (response?.status() === 404) {
        return "";
      }

      if (await isCloudflareChallengePage(page)) {
        console.log(
          `Liquor.com Cloudflare challenge detected. Complete it in the Chrome window: ${url}`
        );
        try {
          await page.waitForFunction(
            () => {
              const title = document.title;
              const html = document.documentElement?.innerHTML ?? "";

              return (
                title !== "Just a moment..." &&
                !html.includes("/cdn-cgi/challenge-platform/")
              );
            },
            { timeout: challengeTimeoutMs }
          );
        } catch {
          throw new Error(
            `Liquor.com browser did not clear the Cloudflare challenge after ${challengeTimeoutMs}ms: ${url}. Launch Chrome manually with remote debugging, solve the challenge, and set LIQUOR_BROWSER_DEBUG_URL.`
          );
        }
      }

      const html = await page.content();

      if (isCloudflareChallengeHtml(html)) {
        throw new Error(
          `Liquor.com browser remained on a Cloudflare challenge after ${challengeTimeoutMs}ms: ${url}`
        );
      }

      return html;
    }
  };
}

async function resolveChromeExecutablePath(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.LIQUOR_BROWSER_EXECUTABLE_PATH?.trim();

  if (configured) {
    await assertExecutableExists(configured);
    return configured;
  }

  for (const candidate of chromeExecutableCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not find Chrome or Chromium for Liquor.com backfill. Set LIQUOR_BROWSER_EXECUTABLE_PATH to the browser executable."
  );
}

async function assertExecutableExists(value: string): Promise<void> {
  try {
    await access(value);
  } catch {
    throw new Error(
      `LIQUOR_BROWSER_EXECUTABLE_PATH points to a missing browser executable: ${value}`
    );
  }
}

async function isCloudflareChallengePage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const html = document.documentElement?.innerHTML ?? "";
    return (
      document.title === "Just a moment..." ||
      html.includes("/cdn-cgi/challenge-platform/")
    );
  });
}

function isCloudflareChallengeHtml(html: string): boolean {
  return (
    html.includes("<title>Just a moment...</title>") ||
    html.includes("/cdn-cgi/challenge-platform/")
  );
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const configured = value?.trim().toLowerCase();

  if (!configured) {
    return fallback;
  }

  if (["1", "true", "yes"].includes(configured)) {
    return true;
  }

  if (["0", "false", "no"].includes(configured)) {
    return false;
  }

  throw new Error(
    `LIQUOR_BROWSER_HEADLESS must be true or false, got: ${value}`
  );
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }

  return parsed;
}
