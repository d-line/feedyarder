import { NavLink, Route, Routes } from "react-router-dom";

const sampleItems = [
  {
    id: "01",
    feed: "planet.postgres",
    title: "Vacuum tuning without folklore",
    publishedAt: "3h ago",
    expanded: true,
    author: "A. Example",
    body:
      "Autovacuum is not magic. Measure table churn, dead tuples, and write pressure before changing settings. Inactive feeds and noisy feeds need different policies too.",
    read: false,
    starred: true
  },
  {
    id: "02",
    feed: "hn.frontpage",
    title: "Monorepo build systems people actually keep",
    publishedAt: "5h ago",
    expanded: false,
    author: null,
    body: "",
    read: true,
    starred: false
  },
  {
    id: "03",
    feed: "yt.channel",
    title: "Why feed parsers fail on real-world XML",
    publishedAt: "yesterday",
    expanded: false,
    author: "Channel Host",
    body: "",
    read: false,
    starred: false
  }
];

const sampleFeeds = [
  {
    id: "f-001",
    title: "planet.postgres",
    folder: "databases",
    status: "ok",
    interval: "60m",
    errors: 0
  },
  {
    id: "f-002",
    title: "broken.example/rss.xml",
    folder: "watchlist",
    status: "parse",
    interval: "240m",
    errors: 7
  },
  {
    id: "f-003",
    title: "slow-news-feed",
    folder: "general",
    status: "network",
    interval: "120m",
    errors: 2
  }
];

const navItems = [
  {
    to: "/setup",
    label: "setup"
  },
  {
    to: "/reader",
    label: "reader"
  },
  {
    to: "/admin",
    label: "admin"
  }
];

export function App() {
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
              <dd>bootstrap</dd>
            </div>
            <div>
              <dt>api</dt>
              <dd>public-only</dd>
            </div>
            <div>
              <dt>ui</dt>
              <dd>tui-style</dd>
            </div>
          </dl>
        </section>
      </aside>

      <main className="screen-panel">
        <header className="screen-header">
          <p className="screen-header-line">[reader shell initialized]</p>
          <p className="screen-header-line">
            routes: <span>/setup</span> <span>/reader</span> <span>/admin</span>
          </p>
        </header>

        <Routes>
          <Route path="/" element={<SetupRoute />} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/reader" element={<ReaderRoute />} />
          <Route path="/admin" element={<AdminRoute />} />
        </Routes>
      </main>
    </div>
  );
}

function SetupRoute() {
  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ bootstrap</p>
        <h1>create the only local user</h1>
        <p className="section-copy">
          This is the first-run setup surface. It stays small: username,
          password, submit, then the app moves to authenticated mode.
        </p>
      </header>

      <form className="terminal-form">
        <label className="form-row">
          <span>username</span>
          <input defaultValue="operator" name="username" type="text" />
        </label>
        <label className="form-row">
          <span>password</span>
          <input name="password" type="password" value="••••••••••••••••" readOnly />
        </label>
        <div className="form-actions">
          <button type="button">run setup</button>
          <span className="hint-text">POST /setup</span>
        </div>
      </form>
    </section>
  );
}

function ReaderRoute() {
  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ reader</p>
        <h1>single-pane story stream</h1>
        <p className="section-copy">
          Endless keyset pagination, unread/all switching, folder/feed filters,
          search, and inline expansion.
        </p>
      </header>

      <div className="toolbar">
        <span className="toolbar-label">filters</span>
        <button className="toolbar-button toolbar-button-active" type="button">
          unread
        </button>
        <button className="toolbar-button" type="button">
          all
        </button>
        <button className="toolbar-button" type="button">
          starred
        </button>
        <button className="toolbar-button" type="button">
          folder:databases
        </button>
        <button className="toolbar-button" type="button">
          search:/parser
        </button>
      </div>

      <div className="story-list" role="list">
        {sampleItems.map((item) => (
          <article
            key={item.id}
            className={item.read ? "story-row story-row-read" : "story-row"}
          >
            <div className="story-collapsed">
              <span className="story-id">{item.id}</span>
              <span className="story-feed">{item.feed}</span>
              <span className="story-title">{item.title}</span>
              <span className="story-time">{item.publishedAt}</span>
            </div>

            {item.expanded ? (
              <div className="story-expanded">
                <div className="story-meta">
                  <span>pub:{item.publishedAt}</span>
                  <span>author:{item.author ?? "unknown"}</span>
                  <span>read:{item.read ? "yes" : "no"}</span>
                  <span>starred:{item.starred ? "yes" : "no"}</span>
                </div>
                <p className="story-body">{item.body}</p>
                <div className="story-actions">
                  <button type="button">toggle read</button>
                  <button type="button">toggle star</button>
                  <button type="button">open source</button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminRoute() {
  return (
    <section className="screen-content">
      <header className="section-header">
        <p className="section-kicker">$ admin</p>
        <h1>feed health and import controls</h1>
        <p className="section-copy">
          This page handles feed CRUD, folder assignment, fetch status, and OPML
          import/export without polluting the reader surface.
        </p>
      </header>

      <div className="toolbar">
        <button className="toolbar-button toolbar-button-active" type="button">
          add feed
        </button>
        <button className="toolbar-button" type="button">
          import opml
        </button>
        <button className="toolbar-button" type="button">
          export opml
        </button>
      </div>

      <section className="table-shell" aria-label="Feed health">
        <div className="table-head">
          <span>feed</span>
          <span>folder</span>
          <span>status</span>
          <span>interval</span>
          <span>errors</span>
        </div>

        {sampleFeeds.map((feed) => (
          <div key={feed.id} className="table-row">
            <span>{feed.title}</span>
            <span>{feed.folder}</span>
            <span className={`status-pill status-${feed.status}`}>{feed.status}</span>
            <span>{feed.interval}</span>
            <span>{feed.errors}</span>
          </div>
        ))}
      </section>
    </section>
  );
}
