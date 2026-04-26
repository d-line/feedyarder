import { useEffect, useRef, useState } from "react";
import { type Feed, type Folder, type Item } from "@feedyarder/contracts";
import {
  getApiErrorMessage,
  listFeeds,
  listFolders,
  listItems,
  updateItemState
} from "./api-client.js";
import { sanitizeFeedHtml } from "./sanitize-feed-html.js";

export function ReaderRoute() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({
    feedId: "",
    folderId: "",
    q: "",
    readMode: "unread" as "all" | "unread",
    starredOnly: false
  });
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastCollapsedButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadReaderState(true);
  }, [filters.feedId, filters.folderId, filters.q, filters.readMode, filters.starredOnly]);

  useEffect(() => {
    if (items.length === 0) {
      setActiveItemId("");
      setExpandedItemId(null);
      return;
    }

    if (!items.some((item) => item.id === activeItemId)) {
      setActiveItemId(items[0]?.id ?? "");
    }

    if (expandedItemId && !items.some((item) => item.id === expandedItemId)) {
      setExpandedItemId(null);
    }
  }, [activeItemId, expandedItemId, items]);

  useEffect(() => {
    if (!nextCursor || isLoadingMore || isLoading || items.length === 0) {
      return;
    }

    const target = lastCollapsedButtonRef.current;

    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }

        void loadReaderState(false);
      },
      {
        threshold: 0.01
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [isLoading, isLoadingMore, items, nextCursor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isInteractiveTarget(event.target)) {
        if (event.key === "Escape" && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        return;
      }

      const activeIndex = items.findIndex((item) => item.id === activeItemId);
      const selectedItem = activeIndex >= 0 ? items[activeIndex] ?? null : (items[0] ?? null);

      switch (key) {
        case "/":
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          return;
        case "Escape":
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          return;
        case "a":
          event.preventDefault();
          setFilters((current) => ({
            ...current,
            readMode: "all"
          }));
          return;
        case "u":
          event.preventDefault();
          setFilters((current) => ({
            ...current,
            readMode: "unread"
          }));
          return;
        default:
          break;
      }

      if (!selectedItem) {
        return;
      }

      switch (key) {
        case "j":
        case "ArrowDown": {
          event.preventDefault();

          const nextItem = activeIndex >= 0 ? items[activeIndex + 1] ?? null : (items[0] ?? null);

          if (nextItem) {
            selectItem(nextItem.id, {
              carryExpanded: expandedItemId === selectedItem.id
            });
          }

          return;
        }
        case "k":
        case "ArrowUp": {
          event.preventDefault();

          if (activeIndex <= 0) {
            selectItem(selectedItem.id);
            return;
          }

          const previousItem = items[activeIndex - 1] ?? null;

          if (previousItem) {
            selectItem(previousItem.id, {
              carryExpanded: expandedItemId === selectedItem.id
            });
          }

          return;
        }
        case "Enter":
        case "o":
          event.preventDefault();
          handleToggleExpanded(selectedItem.id);
          return;
        case "m":
          event.preventDefault();
          void handleToggleRead(selectedItem);
          return;
        case "s":
          event.preventDefault();
          void handleToggleStar(selectedItem);
          return;
        default:
          return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeItemId, expandedItemId, items]);

  async function loadReaderState(reset: boolean): Promise<void> {
    try {
      if (reset) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      setErrorMessage(null);

      const [foldersResponse, feedsResponse, itemResponse] = await Promise.all([
        listFolders(),
        listFeeds(),
        loadItemsPage(reset ? null : nextCursor)
      ]);

      setFolders(foldersResponse);
      setFeeds(feedsResponse);
      setItems((current) => (reset ? itemResponse.items : [...current, ...itemResponse.items]));
      setNextCursor(itemResponse.nextCursor);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }

  async function loadItemsPage(cursor: string | null) {
    return listItems({
      cursor,
      limit: 20,
      ...(filters.feedId ? { feedId: filters.feedId } : {}),
      ...(filters.folderId ? { folderId: filters.folderId } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.readMode === "unread" ? { read: false } : {}),
      ...(filters.starredOnly ? { starred: true } : {})
    });
  }

  async function handleToggleRead(item: Item): Promise<void> {
    const updated = await updateItemState(item.id, {
      isRead: !item.isRead
    });

    setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }

  async function handleToggleStar(item: Item): Promise<void> {
    const updated = await updateItemState(item.id, {
      isStarred: !item.isStarred
    });

    setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }

  function scrollItemToTop(itemId: string): void {
    const element = itemRefs.current[itemId];

    if (!element) {
      return;
    }

    const listElement = element.parentElement;
    const listStyles = listElement ? window.getComputedStyle(listElement) : null;
    const rowStyles = window.getComputedStyle(element);
    const rowGap = Number.parseFloat(listStyles?.rowGap ?? listStyles?.gap ?? "0");
    const borderTop = Number.parseFloat(rowStyles.borderTopWidth || "0");
    const visualOffset = rowGap + borderTop + 6;
    const top = window.scrollY + element.getBoundingClientRect().top - visualOffset;

    window.scrollTo({
      behavior: "smooth",
      top: Math.max(0, top)
    });
  }

  function selectItem(itemId: string, options?: { carryExpanded?: boolean }): void {
    setActiveItemId(itemId);

    if (options?.carryExpanded) {
      setExpandedItemId(itemId);

      requestAnimationFrame(() => {
        scrollItemToTop(itemId);
      });

      return;
    }

    requestAnimationFrame(() => {
      itemRefs.current[itemId]?.scrollIntoView({
        block: "nearest"
      });
    });
  }

  function handleToggleExpanded(itemId: string): void {
    setActiveItemId(itemId);
    setExpandedItemId((current) => {
      const nextItemId = current === itemId ? null : itemId;

      if (nextItemId) {
        requestAnimationFrame(() => {
          scrollItemToTop(itemId);
        });
      }

      return nextItemId;
    });
  }

  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ reader</p>
        <h1>single-pane story stream</h1>
        <p className="section-copy">
          Real item data now comes from the public API with cursor pagination, filters, and state toggles.
        </p>
        <p className="section-copy">
          shortcuts: `j/k` move, `enter` open, `m` read, `s` star, `/` search, `u` unread, `a` all
        </p>
      </header>

      <div className="toolbar toolbar-stacked">
        <div className="toolbar">
          <span className="toolbar-label">view</span>
          <button
            className={
              filters.readMode === "unread"
                ? "toolbar-button toolbar-button-active"
                : "toolbar-button"
            }
            onClick={() =>
              setFilters((current) => ({
                ...current,
                readMode: "unread"
              }))
            }
            type="button"
          >
            unread
          </button>
          <button
            className={
              filters.readMode === "all" ? "toolbar-button toolbar-button-active" : "toolbar-button"
            }
            onClick={() =>
              setFilters((current) => ({
                ...current,
                readMode: "all"
              }))
            }
            type="button"
          >
            all
          </button>
          <button
            className={
              filters.starredOnly ? "toolbar-button toolbar-button-active" : "toolbar-button"
            }
            onClick={() =>
              setFilters((current) => ({
                ...current,
                starredOnly: !current.starredOnly
              }))
            }
            type="button"
          >
            starred
          </button>
        </div>

        <div className="toolbar">
          <label className="toolbar-filter">
            <span className="toolbar-label">folder</span>
            <select
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  folderId: event.target.value
                }))
              }
              value={filters.folderId}
            >
              <option value="">all</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-filter">
            <span className="toolbar-label">feed</span>
            <select
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  feedId: event.target.value
                }))
              }
              value={filters.feedId}
            >
              <option value="">all</option>
              {feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.title ?? feed.feedUrl}
                </option>
              ))}
            </select>
          </label>

          <form
            className="toolbar-search"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters((current) => ({
                ...current,
                q: searchInput.trim()
              }));
            }}
          >
            <input
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="search items"
              ref={searchInputRef}
              type="search"
              value={searchInput}
            />
            <button type="submit">search</button>
          </form>
        </div>
      </div>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {isLoading ? <p className="section-copy">Loading items...</p> : null}

      <div className="story-list" role="list">
        {items.map((item) => {
          const isExpanded = expandedItemId === item.id;
          const isActive = item.id === activeItemId;
          const isLastItem = item.id === (items[items.length - 1]?.id ?? "");

          return (
            <article
              key={item.id}
              className={
                item.isRead
                  ? isActive
                    ? "story-row story-row-read story-row-active"
                    : "story-row story-row-read"
                  : isActive
                    ? "story-row story-row-active"
                    : "story-row"
              }
              ref={(element) => {
                itemRefs.current[item.id] = element;
              }}
            >
              <button
                className="story-collapsed story-collapsed-button"
                onClick={() => handleToggleExpanded(item.id)}
                ref={isLastItem ? lastCollapsedButtonRef : undefined}
                type="button"
              >
                <span className="story-active-marker">{isActive ? ">" : " "}</span>
                <span className="story-id">{item.id.slice(0, 8)}</span>
                <span className="story-feed">{item.feedTitle ?? "unknown-feed"}</span>
                <span className="story-title">{item.title ?? "(untitled item)"}</span>
                <span className="story-time">{formatItemTimestamp(item)}</span>
              </button>

              {isExpanded ? (
                <div className="story-expanded">
                  <div className="story-meta">
                    <span>pub:{formatItemTimestamp(item)}</span>
                    <span>author:{item.author ?? "unknown"}</span>
                    <span>read:{item.isRead ? "yes" : "no"}</span>
                    <span>starred:{item.isStarred ? "yes" : "no"}</span>
                  </div>
                  {item.contentHtml ? (
                    <div
                      className="story-body"
                      dangerouslySetInnerHTML={{ __html: sanitizeFeedHtml(item.contentHtml) }}
                    />
                  ) : (
                    <p className="story-body">{item.summaryText ?? "No content."}</p>
                  )}
                  <div className="story-actions">
                    <button onClick={() => void handleToggleRead(item)} type="button">
                      {item.isRead ? "mark unread" : "mark read"}
                    </button>
                    <button onClick={() => void handleToggleStar(item)} type="button">
                      {item.isStarred ? "unstar" : "star"}
                    </button>
                    {item.url ? (
                      <a className="story-link" href={item.url} rel="noreferrer" target="_blank">
                        open source
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {!isLoading && items.length === 0 ? (
        <p className="section-copy">No items match the current filters.</p>
      ) : null}

      {nextCursor ? (
        <div className="load-more-row">
          <button
            disabled={isLoadingMore}
            onClick={() => void loadReaderState(false)}
            type="button"
          >
            {isLoadingMore ? "loading..." : "load more"}
          </button>
          <span className="hint-text">cursor pagination</span>
        </div>
      ) : null}
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  return getApiErrorMessage(error);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatItemTimestamp(item: Item): string {
  return item.publishedAt ? formatTimestamp(item.publishedAt) : "(no pub date)";
}
