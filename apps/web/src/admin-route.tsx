import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  type FetchEvent,
  type Feed,
  type Folder,
  type OpmlImportResponse
} from "@feedyarder/contracts";
import {
  createFeed,
  createFolder,
  deleteFeed,
  deleteFolder,
  exportOpml,
  getApiErrorMessage,
  importOpml,
  listFeeds,
  listFetchEvents,
  listFolders,
  retryFeed,
  updateFeed,
  updateFolder
} from "./api-client.js";

export function AdminRoute() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [fetchEvents, setFetchEvents] = useState<FetchEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [editFolderTitle, setEditFolderTitle] = useState("");
  const [editFolderPosition, setEditFolderPosition] = useState("0");
  const [folderDeleteConfirmation, setFolderDeleteConfirmation] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedTitle, setFeedTitle] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [folderId, setFolderId] = useState("");
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editFeedTitle, setEditFeedTitle] = useState("");
  const [editSiteUrl, setEditSiteUrl] = useState("");
  const [editFolderId, setEditFolderId] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);
  const [isSubmittingFeed, setIsSubmittingFeed] = useState(false);
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [isSavingFeed, setIsSavingFeed] = useState(false);
  const [isDeletingFeed, setIsDeletingFeed] = useState(false);
  const [opmlText, setOpmlText] = useState("");
  const [isImportingOpml, setIsImportingOpml] = useState(false);
  const [isExportingOpml, setIsExportingOpml] = useState(false);
  const [opmlResult, setOpmlResult] = useState<OpmlImportResponse | null>(null);
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;

  useEffect(() => {
    void loadAdminState();
  }, []);

  useEffect(() => {
    if (folders.length === 0) {
      applyFolderEditor(null);
      return;
    }

    if (!selectedFolderId) {
      applyFolderEditor(folders[0] ?? null);
      return;
    }

    const nextSelectedFolder = folders.find((folder) => folder.id === selectedFolderId);

    if (!nextSelectedFolder) {
      applyFolderEditor(folders[0] ?? null);
    }
  }, [folders, selectedFolderId]);

  useEffect(() => {
    if (feeds.length === 0) {
      applyFeedEditor(null);
      return;
    }

    if (!selectedFeedId) {
      applyFeedEditor(feeds[0] ?? null);
      return;
    }

    const nextSelectedFeed = feeds.find((feed) => feed.id === selectedFeedId);

    if (!nextSelectedFeed) {
      applyFeedEditor(feeds[0] ?? null);
    }
  }, [feeds, selectedFeedId]);

  function applyFolderEditor(folder: Folder | null): void {
    setSelectedFolderId(folder?.id ?? "");
    setEditFolderTitle(folder?.title ?? "");
    setEditFolderPosition(String(folder?.position ?? 0));
    setFolderDeleteConfirmation("");
  }

  function applyFeedEditor(feed: Feed | null): void {
    setSelectedFeedId(feed?.id ?? "");
    setEditFeedUrl(feed?.feedUrl ?? "");
    setEditFeedTitle(feed?.title ?? "");
    setEditSiteUrl(feed?.siteUrl ?? "");
    setEditFolderId(feed?.folderId ?? "");
    setDeleteConfirmation("");
  }

  async function loadAdminState(): Promise<void> {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [foldersResponse, feedsResponse, fetchEventsResponse] = await Promise.all([
        listFolders(),
        listFeeds(),
        listFetchEvents(15)
      ]);

      setFolders(foldersResponse);
      setFeeds(feedsResponse);
      setFetchEvents(fetchEventsResponse);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmittingFolder(true);
    setErrorMessage(null);

    try {
      const createdFolder = await createFolder({
        position: folders.length,
        title: folderTitle
      });

      setFolders((current) => sortFolders([...current, createdFolder]));
      applyFolderEditor(createdFolder);
      setFolderTitle("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmittingFolder(false);
    }
  }

  async function handleCreateFeed(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmittingFeed(true);
    setErrorMessage(null);

    try {
      const createdFeed = await createFeed({
        feedUrl,
        folderId: folderId || null,
        siteUrl: siteUrl || null,
        title: feedTitle || null
      });

      setFeeds((current) => [...current, createdFeed]);
      applyFeedEditor(createdFeed);
      setFeedUrl("");
      setFeedTitle("");
      setSiteUrl("");
      setFolderId("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmittingFeed(false);
    }
  }

  async function handleUpdateFolder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFolder) {
      return;
    }

    setIsSavingFolder(true);
    setErrorMessage(null);

    try {
      const updatedFolder = await updateFolder(selectedFolder.id, {
        position: Number.parseInt(editFolderPosition, 10),
        title: editFolderTitle.trim()
      });

      setFolders((current) =>
        sortFolders(current.map((entry) => (entry.id === updatedFolder.id ? updatedFolder : entry)))
      );
      applyFolderEditor(updatedFolder);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSavingFolder(false);
    }
  }

  async function handleDeleteFolder(): Promise<void> {
    if (!selectedFolder) {
      return;
    }

    setIsDeletingFolder(true);
    setErrorMessage(null);

    try {
      await deleteFolder(selectedFolder.id);

      setFolders((current) => current.filter((entry) => entry.id !== selectedFolder.id));
      setFolderId((current) => (current === selectedFolder.id ? "" : current));
      setEditFolderId((current) => (current === selectedFolder.id ? "" : current));
      setFeeds((current) =>
        current.map((entry) =>
          entry.folderId === selectedFolder.id ? { ...entry, folderId: null } : entry
        )
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsDeletingFolder(false);
    }
  }

  async function handleToggleFeedPaused(feed: Feed): Promise<void> {
    try {
      setErrorMessage(null);

      const updatedFeed = await updateFeed(feed.id, {
        isPaused: !feed.isPaused
      });

      setFeeds((current) => current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry)));
      if (selectedFeedId === updatedFeed.id) {
        applyFeedEditor(updatedFeed);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleRetryFeed(feed: Feed): Promise<void> {
    try {
      setErrorMessage(null);

      const updatedFeed = await retryFeed(feed.id);

      setFeeds((current) => current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry)));
      if (selectedFeedId === updatedFeed.id) {
        applyFeedEditor(updatedFeed);
      }
      await loadAdminState();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
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
      const updatedFeed = await updateFeed(selectedFeed.id, {
        feedUrl: editFeedUrl.trim(),
        folderId: editFolderId || null,
        siteUrl: editSiteUrl.trim() || null,
        title: editFeedTitle.trim() || null
      });

      setFeeds((current) => current.map((entry) => (entry.id === updatedFeed.id ? updatedFeed : entry)));
      applyFeedEditor(updatedFeed);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
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
      setFetchEvents((current) => current.filter((event) => event.feedId !== selectedFeed.id));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsDeletingFeed(false);
    }
  }

  async function handleImportOpml(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsImportingOpml(true);
    setErrorMessage(null);
    setOpmlResult(null);

    try {
      const result = await importOpml(opmlText);

      setOpmlResult(result);
      setOpmlText("");
      await loadAdminState();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsImportingOpml(false);
    }
  }

  async function handleOpmlFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setOpmlText(await file.text());
    event.target.value = "";
  }

  async function handleExportOpml(): Promise<void> {
    try {
      setIsExportingOpml(true);
      setErrorMessage(null);

      const opml = await exportOpml();
      const blob = new Blob([opml], {
        type: "application/xml;charset=utf-8"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "feedyarder.opml";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsExportingOpml(false);
    }
  }

  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ admin</p>
        <h1>feed health and import controls</h1>
        <p className="section-copy">
          Feed creation is live, and operator controls now cover pause/resume,
          retry-now, recent fetch history, and OPML import/export.
        </p>
      </header>

      <div className="admin-grid">
        <form className="terminal-form" onSubmit={(event) => void handleCreateFolder(event)}>
          <p className="status-title">new folder</p>
          <label className="form-row">
            <span>title</span>
            <input
              onChange={(event) => setFolderTitle(event.target.value)}
              type="text"
              value={folderTitle}
            />
          </label>
          <div className="form-actions">
            <button disabled={isSubmittingFolder || folderTitle.trim().length === 0} type="submit">
              {isSubmittingFolder ? "working..." : "create folder"}
            </button>
            <span className="hint-text">POST /folders</span>
          </div>
        </form>

        <form className="terminal-form" onSubmit={(event) => void handleUpdateFolder(event)}>
          <p className="status-title">edit folder</p>
          {selectedFolder ? (
            <>
              <label className="form-row">
                <span>selected folder</span>
                <select
                  onChange={(event) => {
                    const nextFolder =
                      folders.find((folder) => folder.id === event.target.value) ?? null;
                    applyFolderEditor(nextFolder);
                  }}
                  value={selectedFolderId}
                >
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-row">
                <span>title</span>
                <input
                  onChange={(event) => setEditFolderTitle(event.target.value)}
                  type="text"
                  value={editFolderTitle}
                />
              </label>
              <label className="form-row">
                <span>position</span>
                <input
                  min="0"
                  onChange={(event) => setEditFolderPosition(event.target.value)}
                  type="number"
                  value={editFolderPosition}
                />
              </label>
              <label className="form-row">
                <span>delete confirmation</span>
                <input
                  onChange={(event) => setFolderDeleteConfirmation(event.target.value)}
                  placeholder={selectedFolder.title}
                  type="text"
                  value={folderDeleteConfirmation}
                />
              </label>
              <div className="folder-impact-note">
                feeds in folder:
                {
                  feeds.filter((feed) => feed.folderId === selectedFolder.id).length
                }
                . deleting the folder will leave those feeds unassigned.
              </div>
              <div className="form-actions">
                <button
                  disabled={
                    isSavingFolder ||
                    editFolderTitle.trim().length === 0 ||
                    Number.isNaN(Number.parseInt(editFolderPosition, 10))
                  }
                  type="submit"
                >
                  {isSavingFolder ? "saving..." : "save folder"}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => applyFolderEditor(selectedFolder)}
                  type="button"
                >
                  reset
                </button>
                <button
                  disabled={
                    isDeletingFolder ||
                    folderDeleteConfirmation.trim() !== selectedFolder.title
                  }
                  onClick={() => void handleDeleteFolder()}
                  type="button"
                >
                  {isDeletingFolder ? "deleting..." : "delete folder"}
                </button>
              </div>
            </>
          ) : (
            <p className="section-copy">No folders available to edit.</p>
          )}
        </form>

        <form className="terminal-form" onSubmit={(event) => void handleCreateFeed(event)}>
          <p className="status-title">new feed</p>
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
          <div className="form-actions">
            <button disabled={isSubmittingFeed || feedUrl.trim().length === 0} type="submit">
              {isSubmittingFeed ? "working..." : "create feed"}
            </button>
            <button className="secondary-button" onClick={() => void loadAdminState()} type="button">
              refresh
            </button>
            <span className="hint-text">POST /feeds</span>
          </div>
        </form>
      </div>

      <form className="terminal-form terminal-form-wide" onSubmit={(event) => void handleUpdateFeed(event)}>
        <p className="status-title">edit feed</p>
        {selectedFeed ? (
          <>
            <div className="feed-editor-meta">
              <span>status:{selectedFeed.isPaused ? "paused" : selectedFeed.status}</span>
              <span>interval:{selectedFeed.fetchIntervalMinutes}m</span>
              <span>errors:{selectedFeed.consecutiveErrorCount}</span>
              <span>last success:{selectedFeed.lastSuccessAt ? formatTimestamp(selectedFeed.lastSuccessAt) : "never"}</span>
            </div>

            <div className="admin-grid">
              <label className="form-row">
                <span>selected feed</span>
                <select
                  onChange={(event) => {
                    const nextFeed = feeds.find((feed) => feed.id === event.target.value) ?? null;
                    applyFeedEditor(nextFeed);
                  }}
                  value={selectedFeedId}
                >
                  {feeds.map((feed) => (
                    <option key={feed.id} value={feed.id}>
                      {feed.title ?? feed.feedUrl}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-row">
                <span>folder</span>
                <select onChange={(event) => setEditFolderId(event.target.value)} value={editFolderId}>
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
                <span>delete confirmation</span>
                <input
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder={selectedFeed.feedUrl}
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
                onClick={() => applyFeedEditor(selectedFeed)}
                type="button"
              >
                reset
              </button>
              <button
                disabled={
                  isDeletingFeed || deleteConfirmation.trim() !== selectedFeed.feedUrl
                }
                onClick={() => void handleDeleteFeed()}
                type="button"
              >
                {isDeletingFeed ? "deleting..." : "delete feed"}
              </button>
              <span className="hint-text">type the current feed url to confirm deletion</span>
            </div>
          </>
        ) : (
          <p className="section-copy">No feeds available to edit.</p>
        )}
      </form>

      <div className="admin-grid admin-grid-wide">
        <form className="terminal-form" onSubmit={(event) => void handleImportOpml(event)}>
          <p className="status-title">import opml</p>
          <label className="form-row">
            <span>file</span>
            <input accept=".opml,.xml,text/xml,application/xml" onChange={(event) => void handleOpmlFileChange(event)} type="file" />
          </label>
          <label className="form-row">
            <span>opml xml</span>
            <textarea
              className="opml-textarea"
              onChange={(event) => setOpmlText(event.target.value)}
              placeholder="Paste OPML here or load a file above"
              value={opmlText}
            />
          </label>
          <div className="form-actions">
            <button disabled={isImportingOpml || opmlText.trim().length === 0} type="submit">
              {isImportingOpml ? "importing..." : "import opml"}
            </button>
            <span className="hint-text">POST /opml/import</span>
          </div>
          {opmlResult ? (
            <p className="section-copy">
              imported feeds:{opmlResult.createdFeedCount} folders:{opmlResult.createdFolderCount} skipped:{opmlResult.skippedFeedCount}
            </p>
          ) : null}
        </form>

        <section className="terminal-form">
          <p className="status-title">export opml</p>
          <p className="section-copy">
            Export the current folder tree and all feeds, including paused ones.
          </p>
          <div className="form-actions">
            <button disabled={isExportingOpml} onClick={() => void handleExportOpml()} type="button">
              {isExportingOpml ? "exporting..." : "download opml"}
            </button>
            <span className="hint-text">GET /opml/export</span>
          </div>
        </section>
      </div>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <section className="table-shell table-shell-tight" aria-label="Folders">
        <div className="table-head">
          <span>folder</span>
          <span>position</span>
          <span>created</span>
          <span>actions</span>
        </div>
        {folders.length === 0 ? (
          <div className="table-row table-row-empty">
            <span>no folders yet</span>
          </div>
        ) : (
          folders.map((folder) => (
            <div key={folder.id} className="table-row">
              <span>{folder.title}</span>
              <span>{folder.position}</span>
              <span>{formatTimestamp(folder.createdAt)}</span>
              <span className="table-actions">
                <button onClick={() => applyFolderEditor(folder)} type="button">
                  edit
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <section className="table-shell" aria-label="Feed health">
        <div className="table-head">
          <span>feed</span>
          <span>folder</span>
          <span>status</span>
          <span>interval</span>
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
            <div key={feed.id} className="table-row">
              <span>
                <strong>{feed.title ?? feed.feedUrl}</strong>
                <br />
                <span className="table-subline">{feed.lastErrorMessage ?? feed.feedUrl}</span>
              </span>
              <span>{findFolderTitle(folders, feed.folderId)}</span>
              <span className={`status-pill status-${getFeedTone(feed)}`}>
                {feed.isPaused ? "paused" : feed.status}
              </span>
              <span>{feed.fetchIntervalMinutes}m</span>
              <span>{feed.consecutiveErrorCount}</span>
              <span className="table-actions">
                <button onClick={() => applyFeedEditor(feed)} type="button">
                  edit
                </button>
                <button onClick={() => void handleToggleFeedPaused(feed)} type="button">
                  {feed.isPaused ? "resume" : "pause"}
                </button>
                <button onClick={() => void handleRetryFeed(feed)} type="button">
                  retry now
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <section className="table-shell" aria-label="Recent fetch events">
        <div className="table-head">
          <span>when</span>
          <span>feed</span>
          <span>status</span>
          <span>details</span>
        </div>

        {fetchEvents.length === 0 ? (
          <div className="table-row table-row-empty">
            <span>no fetch history yet</span>
          </div>
        ) : (
          fetchEvents.map((event) => (
            <div key={event.id} className="table-row">
              <span>{formatTimestamp(event.fetchedAt)}</span>
              <span>{event.feedTitle ?? event.feedUrl}</span>
              <span className={`status-pill status-${getFetchEventTone(event)}`}>
                {event.status}
              </span>
              <span>
                <span className="table-subline">
                  {event.errorMessage ??
                    `http=${event.httpStatus ?? "-"} duration=${event.durationMs ?? "-"}ms missing_pub=${event.missingPublishedAtCount}`}
                </span>
              </span>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  return getApiErrorMessage(error);
}

function findFolderTitle(folders: Folder[], folderId: string | null): string {
  if (!folderId) {
    return "none";
  }

  return folders.find((folder) => folder.id === folderId)?.title ?? "unknown";
}

function sortFolders(folders: Folder[]): Folder[] {
  return [...folders].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
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

  if (feed.lastErrorCategory === "network" || feed.status === "error" || feed.status === "network") {
    return "network";
  }

  return "ok";
}

function getFetchEventTone(event: FetchEvent): "ok" | "parse" | "network" {
  if (event.errorCategory === "parse") {
    return "parse";
  }

  if (event.errorCategory === "network" || event.status === "error") {
    return "network";
  }

  return "ok";
}
