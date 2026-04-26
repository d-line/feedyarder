import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { type User } from "@feedyarder/contracts";
import {
  fetchCurrentUser,
  fetchSetupStatus,
  getApiErrorMessage,
  login,
  logout,
  setupUser
} from "./api-client.js";
import { AdminRoute } from "./admin-route.js";
import { ReaderRoute } from "./reader-route.js";

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

      const setupStatus = await fetchSetupStatus();
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
    const user = await setupUser({ password, username });

    setState({
      errorMessage: null,
      isLoading: false,
      setupCompleted: true,
      user
    });
  }

  async function handleLogin(username: string, password: string): Promise<void> {
    const user = await login({ password, username });

    setState((current) => ({
      ...current,
      errorMessage: null,
      user
    }));
  }

  async function handleLogout(): Promise<void> {
    await logout();

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

function getErrorMessage(error: unknown): string {
  return getApiErrorMessage(error);
}
