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
- `0002_feed_title_search_index.up.sql`
- `0002_feed_title_search_index.down.sql`
- `0003_feed_last_backfilled_at.up.sql`
- `0003_feed_last_backfilled_at.down.sql`

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

For age-restricted YouTube videos, provide a Netscape-format cookies file:

```bash
YT_DLP_COOKIES_FILE=/absolute/path/to/cookies.txt npm run backfill -- <feed-id>
```

For YouTube verification flows that need a JavaScript runtime, enable one for yt-dlp:

```bash
YT_DLP_JS_RUNTIME=node npm run backfill -- <feed-id>
```

If yt-dlp needs external JavaScript components, allow them explicitly:

```bash
YT_DLP_REMOTE_COMPONENTS=ejs:npm npm run backfill -- <feed-id>
```

Large YouTube channels can take hours. YouTube backfill has no yt-dlp timeout by default; set one in milliseconds only when you want a cap:

```bash
YT_DLP_TIMEOUT_MS=7200000 npm run backfill -- <feed-id>
```

YouTube items are inserted as yt-dlp streams them. The default insert batch size is 100 items:

```bash
YT_DLP_BATCH_SIZE=250 npm run backfill -- <feed-id>
```

Completed backfills are marked on the feed. A later backfill attempt skips that feed with a warning unless you force a rerun:

```bash
npm run backfill -- <feed-id> --force
npm run backfill -- --folder <folder-id-or-title> --force
```

The same backfill target also supports Adafruit Blog feeds. It crawls the blog root and numbered archive pages:

```bash
npm run backfill -- <adafruit-feed-id>
```

Adafruit Learn feeds are backfilled by crawling New Guides, discovering categories, crawling each category's pagination, and fetching each unique guide page for publication metadata:

```bash
npm run backfill -- <learn-feed-id>
```

Learn backfill uses a random delay before each Learn request. Defaults are 1500-5000ms:

```bash
LEARN_BACKFILL_DELAY_MIN_MS=5000 LEARN_BACKFILL_DELAY_MAX_MS=15000 npm run backfill -- <learn-feed-id>
```

DOU feeds are backfilled by crawling `https://dou.ua/lenta/` and following DOU archive pagination:

```bash
npm run backfill -- <dou-feed-id>
```

GitHub Blog feeds are backfilled through GitHub Blog's WordPress API pagination:

```bash
npm run backfill -- <github-blog-feed-id>
```

Substack publication feeds are backfilled through their archive API offset pagination:

```bash
npm run backfill -- <substack-feed-id>
```

Known Substack custom domains such as `https://blog.bytebytego.com/feed` and `https://www.the-ai-corner.com/feed` are supported by the same target.

Substack backfill uses a random delay before each archive and post-detail request. Defaults are 5000-15000ms:

```bash
SUBSTACK_BACKFILL_DELAY_MIN_MS=15000 SUBSTACK_BACKFILL_DELAY_MAX_MS=45000 npm run backfill -- <substack-feed-id>
```

Old Reddit subreddit feeds are backfilled through the listing JSON API and its `after` cursor. Feeds like `https://old.reddit.com/r/ethereum/new/.rss` backfill from `/r/ethereum/new/.json` and use Reddit fullname IDs such as `t3_<postId>` as GUIDs so normal RSS fetches dedupe against the same rows:

```bash
npm run backfill -- <reddit-feed-id>
```

Reddit backfill uses a random delay before each listing request. Defaults are 1000-3000ms:

```bash
REDDIT_BACKFILL_DELAY_MIN_MS=5000 REDDIT_BACKFILL_DELAY_MAX_MS=15000 npm run backfill -- <reddit-feed-id>
```

Foreign Affairs feeds are backfilled by crawling the public topics and tags index, following each topic/tag page's `?page=` pagination, and fetching each unique article page for RSS-compatible Drupal node IDs:

```bash
npm run backfill -- <foreign-affairs-feed-id>
```

The Foreign Affairs Interview is handled separately from the topics/tags crawl. Feeds titled `The Foreign Affairs Interview` or pointing at `/podcasts/foreign-affairs-interview` crawl that podcast archive, follow its `?page=` pagination, and fetch each unique episode page:

```bash
npm run backfill -- <foreign-affairs-interview-feed-id>
```

Foreign Affairs backfill uses a random delay before each listing and article request. Defaults are 3000-8000ms:

```bash
FOREIGN_AFFAIRS_BACKFILL_DELAY_MIN_MS=8000 FOREIGN_AFFAIRS_BACKFILL_DELAY_MAX_MS=20000 npm run backfill -- <foreign-affairs-feed-id>
```

FLOSS Weekly is backfilled from Libsyn archive pages. The worker crawls `https://flossweekly.libsyn.com/` and `/page/<n>`, reads Libsyn's embedded `window.PAGE_DATA`, and reconciles current RSS items by `libsyn:item-id` before inserting older archive-only episodes:

```bash
npm run backfill -- <floss-weekly-feed-id>
```

Twit.tv show feeds are backfilled generically from Twit episode archives. The worker accepts Twit archive URLs such as `https://twit.tv/episodes?filter[shows]=1639`, Twit show pages, or `feeds.twit.tv` RSS feeds, follows archive `?page=` pagination, fetches each unique episode page, and reconciles visible RSS items by canonical episode URL:

```bash
npm run backfill -- <twit-feed-id>
```

Liquor.com feeds are backfilled from a browser-downloaded URL-set sitemap and a persistent Chrome session. Download `https://www.liquor.com/sitemap_1.xml` in a browser, then pass its local path:

```bash
npm run backfill -- <liquor-feed-id> --sitemap-file "$HOME/Downloads/sitemap_1.xml"
```

The file must be the URL-set sitemap containing article URLs, not the small `sitemap.xml` index.

Liquor.com article and taxonomy pages are Cloudflare-protected. The most reliable workflow is to launch a separate Chrome instance yourself with remote debugging and a dedicated profile:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.feedyarder-liquor-chrome"
```

In that Chrome window, open `https://www.liquor.com`, complete any Cloudflare challenge, and leave the window running. Then attach the backfill to it:

```bash
LIQUOR_BROWSER_DEBUG_URL=http://127.0.0.1:9222 \
npm run backfill -- <liquor-feed-id> --sitemap-file "$HOME/Downloads/sitemap_1.xml"
```

The backfill disconnects without closing the manually launched Chrome. Direct Puppeteer launch remains available when `LIQUOR_BROWSER_DEBUG_URL` is unset, using `LIQUOR_BROWSER_USER_DATA_DIR` and optional `LIQUOR_BROWSER_EXECUTABLE_PATH`, but Cloudflare may reject an automation-launched browser. Docker execution requires a reachable remote-debugging Chrome or a Chrome/Chromium binary in the image.

Liquor.com backfill uses a random delay before each taxonomy and article browser navigation. Defaults are 1000-3000ms:

```bash
LIQUOR_BACKFILL_DELAY_MIN_MS=3000 LIQUOR_BACKFILL_DELAY_MAX_MS=8000 npm run backfill -- <liquor-feed-id>
```
