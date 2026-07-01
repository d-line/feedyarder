import { Fragment, type FormEvent, useEffect, useState } from "react";
import {
  type DiscoveredFeed,
  type Feed,
  type FeedDiscoveryResult,
  type Folder
} from "@feedyarder/contracts";
import {
  createFeed,
  deleteFeed,
  discoverFeeds,
  getApiErrorMessage,
  listFeeds,
  listFolders,
  retryFeed,
  updateFeed
} from "./api-client.js";

export function FeedsRoute() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedTitle, setFeedTitle] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [discoveryResult, setDiscoveryResult] = useState<FeedDiscoveryResult | null>(null);
  const [folderId, setFolderId] = useState("");
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editFeedTitle, setEditFeedTitle] = useState("");
  const [editSiteUrl, setEditSiteUrl] = useState("");
  const [editFolderId, setEditFolderId] = useState("");
  const [editAuthUsername, setEditAuthUsername] = useState("");
  const [editAuthPassword, setEditAuthPassword] = useState("");
  const [editClearAuth, setEditClearAuth] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSubmittingFeed, setIsSubmittingFeed] = useState(false);
  const [isDiscoveringFeeds, setIsDiscoveringFeeds] = useState(false);
  const [isSavingFeed, setIsSavingFeed] = useState(false);
  const [isDeletingFeed, setIsDeletingFeed] = useState(false);
  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;

  useEffect(() => {
    void loadFeedsState();
  }, []);

  useEffect(() => {
    if (selectedFeedId && !selectedFeed) {
      closeFeedEditor();
    }
  }, [selectedFeed, selectedFeedId]);

  function openFeedEditor(feed: Feed): void {
    setSelectedFeedId(feed.id);
    setEditFeedUrl(feed.feedUrl);
    setEditFeedTitle(feed.title ?? "");
    setEditSiteUrl(feed.siteUrl ?? "");
    setEditFolderId(feed.folderId ?? "");
    setEditAuthUsername("");
    setEditAuthPassword("");
    setEditClearAuth(false);
    setDeleteConfirmation("");
  }

  function closeFeedEditor(): void {
    setSelectedFeedId("");
    setEditFeedUrl("");
    setEditFeedTitle("");
    setEditSiteUrl("");
    setEditFolderId("");
    setEditAuthUsername("");
    setEditAuthPassword("");
    setEditClearAuth(false);
    setDeleteConfirmation("");
  }

  async function loadFeedsState(): Promise<void> {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [foldersResponse, feedsResponse] = await Promise.all([
        listFolders(),
        listFeeds({ includeStatistics: true })
      ]);

      setFolders(foldersResponse);
      setFeeds(feedsResponse);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateFeed(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmittingFeed(true);
    setErrorMessage(null);

    try {
      const createdFeed = await createFeed({
        ...buildAuthInput(authUsername, authPassword),
        feedUrl,
        folderId: folderId || null,
        siteUrl: siteUrl || null,
        title: feedTitle || null
      });
      const createdFeedWithStatistics = {
        ...createdFeed,
        itemCount: 0,
        readItemCount: 0
      };

      setFeeds((current) => [...current, createdFeedWithStatistics]);
      openFeedEditor(createdFeedWithStatistics);
      setFeedUrl("");
      setFeedTitle("");
      setSiteUrl("");
      setAuthUsername("");
      setAuthPassword("");
      setDiscoveryUrl("");
      setDiscoveryResult(null);
      setFolderId("");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsSubmittingFeed(false);
    }
  }

  async function handleDiscoverFeeds(): Promise<void> {
    setIsDiscoveringFeeds(true);
    setErrorMessage(null);
    setDiscoveryResult(null);

    try {
      setDiscoveryResult(await discoverFeeds(discoveryUrl));
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsDiscoveringFeeds(false);
    }
  }

  function selectDiscoveredFeed(feed: DiscoveredFeed): void {
    setFeedUrl(feed.feedUrl);
    setFeedTitle(feed.title ?? "");
    setSiteUrl(discoveryResult?.siteUrl ?? discoveryUrl);
  }

  async function handleToggleFeedPaused(feed: Feed): Promise<void> {
    try {
      setErrorMessage(null);

      const updatedFeed = preserveFeedStatistics(
        await updateFeed(feed.id, {
          isPaused: !feed.isPaused
        }),
        feed
      );

      setFeeds((current) =>
        current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry))
      );
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    }
  }

  async function handleRetryFeed(feed: Feed): Promise<void> {
    try {
      setErrorMessage(null);

      const updatedFeed = preserveFeedStatistics(await retryFeed(feed.id), feed);

      setFeeds((current) =>
        current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry))
      );
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    }
  }

  async function handleUpdateFeed(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFeed) {
      return;
    }

    setIsSavingFeed(true);
    setErrorMessage(null);

    try {
      const updatedFeed = preserveFeedStatistics(
        await updateFeed(selectedFeed.id, {
          ...buildEditAuthInput(editAuthUsername, editAuthPassword, editClearAuth),
          feedUrl: editFeedUrl.trim(),
          folderId: editFolderId || null,
          siteUrl: editSiteUrl.trim() || null,
          title: editFeedTitle.trim() || null
        }),
        selectedFeed
      );

      setFeeds((current) =>
        current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry))
      );
      openFeedEditor(updatedFeed);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsSavingFeed(false);
    }
  }

  async function handleDeleteFeed(): Promise<void> {
    if (!selectedFeed) {
      return;
    }

    setIsDeletingFeed(true);
    setErrorMessage(null);

    try {
      await deleteFeed(selectedFeed.id);
      setFeeds((current) => current.filter((entry) => entry.id !== selectedFeed.id));
      closeFeedEditor();
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsDeletingFeed(false);
    }
  }

  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ feeds</p>
        <h1>feed management</h1>
        <p className="section-copy">
          Add feeds, inspect story totals and read progress, and open a feed row to edit it.
        </p>
      </header>

      <form
        className="terminal-form terminal-form-wide"
        onSubmit={(event) => void handleCreateFeed(event)}
      >
        <p className="status-title">new feed</p>
        <div className="admin-grid">
          <div>
            <label className="form-row">
              <span>webpage url</span>
              <input
                onChange={(event) => {
                  setDiscoveryUrl(event.target.value);
                  setDiscoveryResult(null);
                }}
                placeholder="https://example.com"
                type="url"
                value={discoveryUrl}
              />
            </label>
            <div className="form-actions feed-discovery-actions">
              <button
                disabled={isDiscoveringFeeds || discoveryUrl.trim().length === 0}
                onClick={() => void handleDiscoverFeeds()}
                type="button"
              >
                {isDiscoveringFeeds ? "discovering..." : "discover feeds"}
              </button>
              <span className="hint-text">POST /feeds/discover</span>
            </div>
            {discoveryResult ? (
              <div className="feed-discovery-results">
                {discoveryResult.feeds.length === 0 ? (
                  <p className="section-copy">No advertised feeds found on this page.</p>
                ) : (
                  discoveryResult.feeds.map((feed) => (
                    <button
                      className={
                        feed.feedUrl === feedUrl
                          ? "feed-discovery-option feed-discovery-option-selected"
                          : "feed-discovery-option"
                      }
                      key={feed.feedUrl}
                      onClick={() => selectDiscoveredFeed(feed)}
                      type="button"
                    >
                      <span>{feed.title ?? "(untitled feed)"}</span>
                      <span>{feed.type}</span>
                      <span>{feed.feedUrl}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div>
            <label className="form-row">
              <span>feed url</span>
              <input
                onChange={(event) => setFeedUrl(event.target.value)}
                type="url"
                value={feedUrl}
              />
            </label>
            <label className="form-row">
              <span>title override</span>
              <input
                onChange={(event) => setFeedTitle(event.target.value)}
                type="text"
                value={feedTitle}
              />
            </label>
            <label className="form-row">
              <span>site url</span>
              <input
                onChange={(event) => setSiteUrl(event.target.value)}
                type="url"
                value={siteUrl}
              />
            </label>
            <label className="form-row">
              <span>basic auth username</span>
              <input
                autoComplete="off"
                onChange={(event) => setAuthUsername(event.target.value)}
                type="text"
                value={authUsername}
              />
            </label>
            <label className="form-row">
              <span>basic auth password</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                value={authPassword}
              />
            </label>
            <label className="form-row">
              <span>folder</span>
              <select onChange={(event) => setFolderId(event.target.value)} value={folderId}>
                <option value="">none</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button disabled={isSubmittingFeed || feedUrl.trim().length === 0} type="submit">
            {isSubmittingFeed ? "working..." : "create feed"}
          </button>
          <button className="secondary-button" onClick={() => void loadFeedsState()} type="button">
            refresh
          </button>
        </div>
      </form>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <section className="table-shell feed-list-table" aria-label="Feeds">
        <div className="table-head">
          <span>feed</span>
          <span>folder</span>
          <span>stories</span>
          <span>read</span>
          <span>status</span>
          <span>errors</span>
          <span>actions</span>
        </div>

        {isLoading ? (
          <div className="table-row table-row-empty">
            <span>loading...</span>
          </div>
        ) : feeds.length === 0 ? (
          <div className="table-row table-row-empty">
            <span>no feeds yet</span>
          </div>
        ) : (
          feeds.map((feed) => (
            <Fragment key={feed.id}>
              <div className="table-row">
                <span>
                  <strong>{feed.title ?? feed.feedUrl}</strong>
                  <span className="table-subline">{feed.lastErrorMessage ?? feed.feedUrl}</span>
                </span>
                <span>{findFolderTitle(folders, feed.folderId)}</span>
                <span>{feed.itemCount ?? 0}</span>
                <span>{formatReadPercentage(feed)}</span>
                <span className={`status-pill status-${getFeedTone(feed)}`}>
                  {feed.isPaused ? "paused" : feed.status}
                </span>
                <span>{feed.consecutiveErrorCount}</span>
                <span className="table-actions">
                  <button
                    onClick={() =>
                      selectedFeedId === feed.id ? closeFeedEditor() : openFeedEditor(feed)
                    }
                    type="button"
                  >
                    {selectedFeedId === feed.id ? "close" : "edit"}
                  </button>
                  <button onClick={() => void handleToggleFeedPaused(feed)} type="button">
                    {feed.isPaused ? "resume" : "pause"}
                  </button>
                  <button onClick={() => void handleRetryFeed(feed)} type="button">
                    retry now
                  </button>
                </span>
              </div>

              {selectedFeedId === feed.id ? (
                <form
                  className="feed-inline-editor"
                  onSubmit={(event) => void handleUpdateFeed(event)}
                >
                  <div className="feed-editor-meta">
                    <span>interval:{feed.fetchIntervalMinutes}m</span>
                    <span>auth:{feed.hasAuth ? "configured" : "none"}</span>
                    <span>
                      last success:
                      {feed.lastSuccessAt ? formatTimestamp(feed.lastSuccessAt) : "never"}
                    </span>
                  </div>

                  <div className="admin-grid">
                    <label className="form-row">
                      <span>folder</span>
                      <select
                        onChange={(event) => setEditFolderId(event.target.value)}
                        value={editFolderId}
                      >
                        <option value="">none</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-row">
                      <span>feed url</span>
                      <input
                        onChange={(event) => setEditFeedUrl(event.target.value)}
                        type="url"
                        value={editFeedUrl}
                      />
                    </label>

                    <label className="form-row">
                      <span>title override</span>
                      <input
                        onChange={(event) => setEditFeedTitle(event.target.value)}
                        type="text"
                        value={editFeedTitle}
                      />
                    </label>

                    <label className="form-row">
                      <span>site url</span>
                      <input
                        onChange={(event) => setEditSiteUrl(event.target.value)}
                        type="url"
                        value={editSiteUrl}
                      />
                    </label>

                    <label className="form-row">
                      <span>new auth username</span>
                      <input
                        autoComplete="off"
                        disabled={editClearAuth}
                        onChange={(event) => setEditAuthUsername(event.target.value)}
                        placeholder={feed.hasAuth ? "unchanged" : ""}
                        type="text"
                        value={editAuthUsername}
                      />
                    </label>

                    <label className="form-row">
                      <span>new auth password</span>
                      <input
                        autoComplete="new-password"
                        disabled={editClearAuth}
                        onChange={(event) => setEditAuthPassword(event.target.value)}
                        placeholder={feed.hasAuth ? "unchanged" : ""}
                        type="password"
                        value={editAuthPassword}
                      />
                    </label>

                    <label className="form-row form-row-checkbox">
                      <span>clear basic auth</span>
                      <input
                        checked={editClearAuth}
                        disabled={!feed.hasAuth}
                        onChange={(event) => {
                          setEditClearAuth(event.target.checked);
                          if (event.target.checked) {
                            setEditAuthUsername("");
                            setEditAuthPassword("");
                          }
                        }}
                        type="checkbox"
                      />
                    </label>

                    <label className="form-row">
                      <span>delete confirmation</span>
                      <input
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        placeholder={feed.feedUrl}
                        type="text"
                        value={deleteConfirmation}
                      />
                    </label>
                  </div>

                  <div className="form-actions">
                    <button disabled={isSavingFeed || editFeedUrl.trim().length === 0} type="submit">
                      {isSavingFeed ? "saving..." : "save feed"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => openFeedEditor(feed)}
                      type="button"
                    >
                      reset
                    </button>
                    <button
                      disabled={
                        isDeletingFeed || deleteConfirmation.trim() !== feed.feedUrl
                      }
                      onClick={() => void handleDeleteFeed()}
                      type="button"
                    >
                      {isDeletingFeed ? "deleting..." : "delete feed"}
                    </button>
                    <span className="hint-text">
                      type the current feed url to confirm deletion
                    </span>
                  </div>
                </form>
              ) : null}
            </Fragment>
          ))
        )}
      </section>
    </section>
  );
}

function preserveFeedStatistics(updatedFeed: Feed, previousFeed: Feed): Feed {
  return {
    ...updatedFeed,
    itemCount: previousFeed.itemCount,
    readItemCount: previousFeed.readItemCount
  };
}

function buildAuthInput(
  username: string,
  password: string
): { authUsername?: string; authPassword?: string } {
  if (username.trim().length === 0 && password.length === 0) {
    return {};
  }

  return {
    authPassword: password,
    authUsername: username.trim()
  };
}

function buildEditAuthInput(
  username: string,
  password: string,
  clearAuth: boolean
): { authUsername?: string; authPassword?: string; clearAuth?: boolean } {
  if (clearAuth) {
    return { clearAuth: true };
  }

  return buildAuthInput(username, password);
}

function findFolderTitle(folders: Folder[], folderId: string | null): string {
  if (!folderId) {
    return "none";
  }

  return folders.find((folder) => folder.id === folderId)?.title ?? "unknown";
}

function formatReadPercentage(feed: Feed): string {
  const itemCount = feed.itemCount ?? 0;

  if (itemCount === 0) {
    return "0%";
  }

  return `${Math.round(((feed.readItemCount ?? 0) / itemCount) * 100)}%`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function getFeedTone(feed: Feed): "ok" | "parse" | "network" | "paused" {
  if (feed.isPaused) {
    return "paused";
  }

  if (feed.lastErrorCategory === "parse" || feed.status === "parse") {
    return "parse";
  }

  if (
    feed.lastErrorCategory === "network" ||
    feed.status === "error" ||
    feed.status === "network"
  ) {
    return "network";
  }

  return "ok";
}
