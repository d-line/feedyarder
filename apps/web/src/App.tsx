import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

interface User {
  id: string;
  username: string;
  createdAt: string;
}

interface Folder {
  id: string;
  title: string;
  position: number;
  createdAt: string;
}

interface Feed {
  id: string;
  folderId: string | null;
  title: string | null;
  siteUrl: string | null;
  feedUrl: string;
  faviconUrl: string | null;
  status: string;
  isPaused: boolean;
  fetchIntervalMinutes: number;
  consecutiveErrorCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCategory: string | null;
  createdAt: string;
}

interface Item {
  id: string;
  feedId: string;
  feedTitle: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summaryText: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
}

interface ItemListResponse {
  items: Item[];
  nextCursor: string | null;
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

interface AppBootstrapState {
  isLoading: boolean;
  setupCompleted: boolean;
  user: User | null;
  errorMessage: string | null;
}

const navItems = [
  { label: "setup", to: "/setup" },
  { label: "reader", to: "/reader" },
  { label: "admin", to: "/admin" }
];

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function App() {
  const [state, setState] = useState<AppBootstrapState>({
    errorMessage: null,
    isLoading: true,
    setupCompleted: false,
    user: null
  });

  useEffect(() => {
    void loadBootstrapState();
  }, []);

  async function loadBootstrapState(): Promise<void> {
    try {
      setState((current) => ({
        ...current,
        errorMessage: null,
        isLoading: true
      }));

      const setupStatus = await apiRequest<{ setupCompleted: boolean }>("/setup/status");
      const user = await fetchCurrentUser();

      setState({
        errorMessage: null,
        isLoading: false,
        setupCompleted: setupStatus.setupCompleted,
        user
      });
    } catch (error) {
      setState({
        errorMessage: getErrorMessage(error),
        isLoading: false,
        setupCompleted: false,
        user: null
      });
    }
  }

  async function handleSetup(username: string, password: string): Promise<void> {
    const user = await apiRequest<User>("/setup", {
      body: JSON.stringify({ password, username }),
      method: "POST"
    });

    setState({
      errorMessage: null,
      isLoading: false,
      setupCompleted: true,
      user
    });
  }

  async function handleLogin(username: string, password: string): Promise<void> {
    const user = await apiRequest<User>("/session", {
      body: JSON.stringify({ password, username }),
      method: "POST"
    });

    setState((current) => ({
      ...current,
      errorMessage: null,
      user
    }));
  }

  async function handleLogout(): Promise<void> {
    await apiRequest("/session", {
      method: "DELETE"
    });

    setState((current) => ({
      ...current,
      user: null
    }));
  }

  const statusMode = state.user
    ? "authenticated"
    : state.setupCompleted
      ? "login"
      : "bootstrap";

  return (
    <div className="terminal-shell">
      <aside className="chrome-panel">
        <div className="brand-block">
          <p className="brand-name">feedyarder</p>
          <p className="brand-meta">single-user rss operator console</p>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
              to={item.to}
            >
              <span className="nav-prefix">&gt;</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <section className="status-block">
          <p className="status-title">session</p>
          <dl className="status-list">
            <div>
              <dt>mode</dt>
              <dd>{statusMode}</dd>
            </div>
            <div>
              <dt>user</dt>
              <dd>{state.user?.username ?? "anonymous"}</dd>
            </div>
            <div>
              <dt>api</dt>
              <dd>{apiBaseUrl}</dd>
            </div>
          </dl>

          {state.user ? (
            <button className="logout-button" onClick={() => void handleLogout()} type="button">
              logout
            </button>
          ) : null}
        </section>
      </aside>

      <main className="screen-panel">
        <header className="screen-header">
          <p className="screen-header-line">
            {state.isLoading ? "[loading session state]" : "[session state loaded]"}
          </p>
          <p className="screen-header-line">
            routes: <span>/setup</span> <span>/reader</span> <span>/admin</span>
          </p>
        </header>

        <Routes>
          <Route
            path="/"
            element={<Navigate replace to={state.user ? "/reader" : "/setup"} />}
          />
          <Route
            path="/setup"
            element={
              <SetupRoute
                errorMessage={state.errorMessage}
                isLoading={state.isLoading}
                onLogin={handleLogin}
                onRefresh={loadBootstrapState}
                onSetup={handleSetup}
                setupCompleted={state.setupCompleted}
                user={state.user}
              />
            }
          />
          <Route
            path="/reader"
            element={
              <ProtectedRoute
                isLoading={state.isLoading}
                user={state.user}
                view={<ReaderRoute />}
              />
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute
                isLoading={state.isLoading}
                user={state.user}
                view={<AdminRoute />}
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function SetupRoute(props: {
  errorMessage: string | null;
  isLoading: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSetup: (username: string, password: string) => Promise<void>;
  setupCompleted: boolean;
  user: User | null;
}) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (props.user) {
      void navigate("/reader", { replace: true });
    }
  }, [navigate, props.user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setLocalErrorMessage(null);

    try {
      if (props.setupCompleted) {
        await props.onLogin(username, password);
      } else {
        await props.onSetup(username, password);
      }

      void navigate("/reader", { replace: true });
    } catch (error) {
      setLocalErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">{props.setupCompleted ? "$ login" : "$ bootstrap"}</p>
        <h1>
          {props.setupCompleted ? "authenticate local operator" : "create the only local user"}
        </h1>
        <p className="section-copy">
          {props.setupCompleted
            ? "Bootstrap is complete. This screen now acts as the login surface."
            : "First-run setup creates the only local account and immediately opens a session."}
        </p>
      </header>

      <form className="terminal-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="form-row">
          <span>username</span>
          <input
            autoComplete="username"
            name="username"
            onChange={(event) => setUsername(event.target.value)}
            type="text"
            value={username}
          />
        </label>
        <label className="form-row">
          <span>password</span>
          <input
            autoComplete={props.setupCompleted ? "current-password" : "new-password"}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <div className="form-actions">
          <button disabled={isSubmitting || props.isLoading} type="submit">
            {isSubmitting ? "working..." : props.setupCompleted ? "log in" : "run setup"}
          </button>
          <button
            className="secondary-button"
            disabled={isSubmitting}
            onClick={() => void props.onRefresh()}
            type="button"
          >
            refresh status
          </button>
          <span className="hint-text">{props.setupCompleted ? "POST /session" : "POST /setup"}</span>
        </div>
        {localErrorMessage || props.errorMessage ? (
          <p className="form-error">{localErrorMessage ?? props.errorMessage}</p>
        ) : null}
      </form>
    </section>
  );
}

function ProtectedRoute(props: {
  isLoading: boolean;
  user: User | null;
  view: ReactNode;
}) {
  const location = useLocation();

  if (props.isLoading) {
    return (
      <section className="screen-content">
        <p className="section-copy">Loading session state...</p>
      </section>
    );
  }

  if (!props.user) {
    return <Navigate replace state={{ from: location.pathname }} to="/setup" />;
  }

  return <>{props.view}</>;
}

function ReaderRoute() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({
    feedId: "",
    folderId: "",
    q: "",
    readMode: "unread" as "all" | "unread",
    starredOnly: false
  });
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void loadReaderState(true);
  }, [filters.feedId, filters.folderId, filters.q, filters.readMode, filters.starredOnly]);

  async function loadReaderState(reset: boolean): Promise<void> {
    try {
      if (reset) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      setErrorMessage(null);

      const [foldersResponse, feedsResponse, itemResponse] = await Promise.all([
        apiRequest<Folder[]>("/folders"),
        apiRequest<Feed[]>("/feeds"),
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

  async function loadItemsPage(cursor: string | null): Promise<ItemListResponse> {
    const params = new URLSearchParams();
    params.set("limit", "20");

    if (cursor) {
      params.set("cursor", cursor);
    }

    if (filters.feedId) {
      params.set("feedId", filters.feedId);
    }

    if (filters.folderId) {
      params.set("folderId", filters.folderId);
    }

    if (filters.readMode === "unread") {
      params.set("read", "false");
    }

    if (filters.starredOnly) {
      params.set("starred", "true");
    }

    if (filters.q) {
      params.set("q", filters.q);
    }

    return apiRequest<ItemListResponse>(`/items?${params.toString()}`);
  }

  async function handleToggleRead(item: Item): Promise<void> {
    const updated = await apiRequest<Item>(`/items/${item.id}/state`, {
      body: JSON.stringify({
        isRead: !item.isRead
      }),
      method: "PATCH"
    });

    setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }

  async function handleToggleStar(item: Item): Promise<void> {
    const updated = await apiRequest<Item>(`/items/${item.id}/state`, {
      body: JSON.stringify({
        isStarred: !item.isStarred
      }),
      method: "PATCH"
    });

    setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }

  function handleToggleExpanded(itemId: string): void {
    setExpandedIds((current) => {
      const isExpanded = current.includes(itemId);
      const next = isExpanded
        ? current.filter((value) => value !== itemId)
        : [...current, itemId];

      if (!isExpanded) {
        requestAnimationFrame(() => {
          itemRefs.current[itemId]?.scrollIntoView({
            block: "start"
          });
        });
      }

      return next;
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
          const isExpanded = expandedIds.includes(item.id);

          return (
            <article
              key={item.id}
              className={item.isRead ? "story-row story-row-read" : "story-row"}
              ref={(element) => {
                itemRefs.current[item.id] = element;
              }}
            >
              <button
                className="story-collapsed story-collapsed-button"
                onClick={() => handleToggleExpanded(item.id)}
                type="button"
              >
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
                      dangerouslySetInnerHTML={{ __html: item.contentHtml }}
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

function AdminRoute() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedTitle, setFeedTitle] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [folderId, setFolderId] = useState("");
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);
  const [isSubmittingFeed, setIsSubmittingFeed] = useState(false);

  useEffect(() => {
    void loadAdminState();
  }, []);

  async function loadAdminState(): Promise<void> {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [foldersResponse, feedsResponse] = await Promise.all([
        apiRequest<Folder[]>("/folders"),
        apiRequest<Feed[]>("/feeds")
      ]);

      setFolders(foldersResponse);
      setFeeds(feedsResponse);
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
      const createdFolder = await apiRequest<Folder>("/folders", {
        body: JSON.stringify({
          position: folders.length,
          title: folderTitle
        }),
        method: "POST"
      });

      setFolders((current) => [...current, createdFolder]);
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
      const createdFeed = await apiRequest<Feed>("/feeds", {
        body: JSON.stringify({
          feedUrl,
          folderId: folderId || null,
          siteUrl: siteUrl || null,
          title: feedTitle || null
        }),
        method: "POST"
      });

      setFeeds((current) => [...current, createdFeed]);
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

  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ admin</p>
        <h1>feed health and import controls</h1>
        <p className="section-copy">
          This page now talks to the real API for folders and feeds. Edit/delete,
          OPML, and retry controls come next.
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

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <section className="table-shell table-shell-tight" aria-label="Folders">
        <div className="table-head">
          <span>folder</span>
          <span>position</span>
          <span>created</span>
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
              <span>{feed.title ?? feed.feedUrl}</span>
              <span>{findFolderTitle(folders, feed.folderId)}</span>
              <span className={`status-pill status-${normalizeStatus(feed.status)}`}>
                {feed.status}
              </span>
              <span>{feed.fetchIntervalMinutes}m</span>
              <span>{feed.consecutiveErrorCount}</span>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest<User>("/me");
  } catch (error) {
    if (isApiErrorCode(error, "not_authenticated")) {
      return null;
    }

    throw error;
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    throw data;
  }

  return data as T;
}

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof (error as ApiErrorResponse).error?.message === "string"
  ) {
    return (error as ApiErrorResponse).error?.message ?? "Unexpected API error.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function isApiErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    (error as ApiErrorResponse).error?.code === code
  );
}

function findFolderTitle(folders: Folder[], folderId: string | null): string {
  if (!folderId) {
    return "none";
  }

  return folders.find((folder) => folder.id === folderId)?.title ?? "unknown";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatItemTimestamp(item: Item): string {
  return item.publishedAt ? formatTimestamp(item.publishedAt) : "(no pub date)";
}

function normalizeStatus(status: string): "ok" | "parse" | "network" {
  if (status === "parse" || status === "network") {
    return status;
  }

  return "ok";
}
