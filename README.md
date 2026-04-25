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
