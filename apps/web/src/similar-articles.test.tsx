// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listSimilarItems: vi.fn()
}));

vi.mock("./api-client.js", () => ({
  ...apiMocks,
  getApiErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unexpected error."
}));

import { SimilarArticles } from "./similar-articles.js";

describe("SimilarArticles", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("shows a bounded counter and selects a returned item", async () => {
    const item = buildItem();
    const onSelectItem = vi.fn();
    apiMocks.listSimilarItems.mockResolvedValue({
      count: 1,
      hasMore: true,
      items: [item],
      status: "ready"
    });

    await act(async () => {
      root.render(
        <SimilarArticles
          itemId="00000000-0000-0000-0000-000000000101"
          onSelectItem={onSelectItem}
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector("summary")?.textContent).toContain(
      "similar (1+)"
    );

    await act(async () => {
      (container.querySelector(".similar-article") as HTMLButtonElement).click();
    });

    expect(onSelectItem).toHaveBeenCalledWith(item);
  });

  it("does not render a misleading zero while indexing", async () => {
    apiMocks.listSimilarItems.mockResolvedValue({
      count: 0,
      hasMore: false,
      items: [],
      status: "pending"
    });

    await act(async () => {
      root.render(
        <SimilarArticles
          itemId="00000000-0000-0000-0000-000000000102"
          onSelectItem={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("similar:indexing...");
    expect(container.textContent).not.toContain("similar (0)");
  });

  it("applies read-state color classes without visible status labels", async () => {
    const unreadItem = buildItem();
    const readItem = {
      ...buildItem(),
      id: "00000000-0000-0000-0000-000000000202",
      isRead: true,
      title: "Previously opened article"
    };
    apiMocks.listSimilarItems.mockResolvedValue({
      count: 2,
      hasMore: false,
      items: [unreadItem, readItem],
      status: "ready"
    });

    await act(async () => {
      root.render(
        <SimilarArticles
          itemId="00000000-0000-0000-0000-000000000103"
          onSelectItem={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const rows = container.querySelectorAll(".similar-article");

    expect(rows[0]?.classList.contains("similar-article-unread")).toBe(true);
    expect(rows[0]?.getAttribute("aria-label")).toContain("Unread:");
    expect(rows[1]?.classList.contains("similar-article-read")).toBe(true);
    expect(rows[1]?.getAttribute("aria-label")).toContain("Read:");
    expect(container.querySelector(".similar-article-state")).toBeNull();
  });
});

function buildItem() {
  return {
    author: null,
    contentHtml: "<p>body</p>",
    createdAt: "2026-07-01T00:00:00.000Z",
    feedId: "00000000-0000-0000-0000-000000000002",
    feedTitle: "Related Feed",
    id: "00000000-0000-0000-0000-000000000201",
    isRead: false,
    isStarred: false,
    media: {
      durationSeconds: null,
      enclosureUrl: null,
      imageUrl: null,
      kind: null,
      mimeType: null,
      playerUrl: null
    },
    publishedAt: "2026-07-01T00:00:00.000Z",
    summaryText: "summary",
    title: "Related article",
    url: "https://example.com/related"
  };
}
