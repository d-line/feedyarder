# Feedyarder

Feedyarder is a deliberately simple single-user RSS reader.

Current direction:

- React frontend
- Express API
- PostgreSQL
- Separate worker for feed fetching and ingest
- OpenAPI-first API contract
- Docker-friendly local development

See [AGENTS.md](/Users/d-line/Code/feedyarder/AGENTS.md) for the current agreed project memory and working rules.

## Deploy with Docker Compose

`docker-compose.yml` now defines a deployable stack:

- `postgres`
- `migrate` (one-shot startup migration)
- `api`
- `worker`
- `web` (nginx serving built React assets)

### 1. Configure environment

Create or update `.env` with at least:

- `WEB_ORIGIN` (for API CORS, for example `http://localhost:3000`)
- `VITE_API_BASE_URL` (baked into web build, for example `http://localhost:3001`)
- `SESSION_COOKIE_SECURE` (`false` for plain HTTP/local Docker, `true` when behind HTTPS)
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional, for notifications)
- Optional DB overrides: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

### 2. Build and start

```bash
docker compose up --build -d
```

### 3. Service endpoints

- Web UI: `http://localhost:3000`
- API: `http://localhost:3001`
- PostgreSQL: `localhost:5432`

### 4. Operations

```bash
docker compose logs -f api worker web
docker compose down
```

## Database Migrations

Migration framework now uses versioned `up/down` scripts in `packages/db/migrations`:

- `0001_initial.up.sql`
- `0001_initial.down.sql`

Run commands from repo root:

```bash
npm run db:migrate:status
npm run db:migrate:up
npm run db:migrate:down -- 1
```

Default migrate command still runs `up`:

```bash
npm run db:migrate
```

## API Contract Codegen

Contracts in `packages/contracts/src/api.generated.ts` are generated from OpenAPI:

```bash
npm run generate:api -w @feedyarder/contracts
```

`packages/contracts/src/api.ts` is a stable facade for app imports.
To verify generated artifacts are committed and up to date:

```bash
npm run generate:api:check -w @feedyarder/contracts
```

## Testing

Default workspace tests run unit/smoke suites only:

```bash
npm test
```

Run Postgres-backed integration tests explicitly:

```bash
npm run test:integration
```

Run both:

```bash
npm run test:all
```
