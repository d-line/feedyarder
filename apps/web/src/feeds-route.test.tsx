// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createFeed: vi.fn(),
  deleteFeed: vi.fn(),
  discoverFeeds: vi.fn(),
  listFeeds: vi.fn(),
  listFolders: vi.fn(),
  listItems: vi.fn(),
  retryFeed: vi.fn(),
  updateFeed: vi.fn()
}));

vi.mock("./api-client.js", () => ({
  ...apiMocks,
  getApiErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unexpected error."
}));

import { FeedsRoute } from "./feeds-route.js";
import { ReaderRoute } from "./reader-route.js";

describe("FeedsRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    apiMocks.listItems.mockResolvedValue({ items: [], nextCursor: null });

    apiMocks.listFolders.mockResolvedValue([
      {
        createdAt: "2026-04-25T00:00:00.000Z",
        id: "00000000-0000-0000-0000-000000000201",
        position: 0,
        title: "news"
      }
    ]);
    apiMocks.listFeeds.mockResolvedValue([
      {
        consecutiveErrorCount: 0,
        createdAt: "2026-04-25T00:00:00.000Z",
        faviconUrl: null,
        feedUrl: "https://example.com/feed.xml",
        fetchIntervalMinutes: 60,
        folderId: "00000000-0000-0000-0000-000000000201",
        hasAuth: true,
        id: "00000000-0000-0000-0000-000000000101",
        isPaused: false,
        itemCount: 8,
        lastErrorAt: null,
        lastErrorCategory: null,
        lastErrorMessage: null,
        lastSuccessAt: "2026-04-25T01:00:00.000Z",
        readItemCount: 6,
        siteUrl: "https://example.com",
        status: "active",
        title: "Example feed"
      }
    ]);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("shows feed statistics and opens the editor directly below its row", async () => {
    await act(async () => {
      root.render(<MemoryRouter><FeedsRoute /></MemoryRouter>);
      await Promise.resolve();
    });

    const feedRow = container.querySelector(".feed-list-row");

    expect(apiMocks.listFeeds).toHaveBeenCalledWith({ includeStatistics: true });
    expect(feedRow?.textContent).toContain("Example feed");
    expect(feedRow?.textContent).toContain("8 stories");
    expect(feedRow?.textContent).toContain("75% read");

    const editButton = Array.from(feedRow?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "edit"
    );

    await act(async () => {
      editButton?.click();
    });

    expect(feedRow?.nextElementSibling?.classList.contains("feed-inline-editor")).toBe(true);
    expect(feedRow?.nextElementSibling?.textContent).toContain("auth:configured");
    expect(
      (feedRow?.nextElementSibling?.querySelector('input[type="url"]') as HTMLInputElement)
        .value
    ).toBe("https://example.com/feed.xml");
  });

  it.each([
    { label: "stories", key: "feedId", id: "00000000-0000-0000-0000-000000000101", selectIndex: 1 },
    { label: "news", key: "folderId", id: "00000000-0000-0000-0000-000000000201", selectIndex: 0 }
  ])("opens unread stories through the $label link", async ({ label, key, id, selectIndex }) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/feeds"]}>
          <Routes>
            <Route path="/feeds" element={<FeedsRoute />} />
            <Route path="/reader" element={<ReaderRoute />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>(".feed-list-row a"))
      .find((entry) => entry.textContent?.trim() === label);
    expect(link?.getAttribute("href")).toBe(`/reader?${key}=${id}`);

    await act(async () => {
      link?.click();
    });

    expect(apiMocks.listItems).toHaveBeenLastCalledWith({
      cursor: null,
      limit: 100,
      read: false,
      [key]: id
    });
    const select = container.querySelectorAll<HTMLSelectElement>(".toolbar-filter select")[selectIndex];
    expect(select?.value).toBe(id);

    await act(async () => {
      if (select) {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(apiMocks.listItems).toHaveBeenLastCalledWith({ cursor: null, limit: 100, read: false });
  });
});
