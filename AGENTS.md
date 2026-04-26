# Feedyarder Working Memory

This file is the assistant's persistent working memory for the project.
It records the current product decisions, architecture choices, and delivery style.
If the project direction changes, this file must be updated to reflect the new agreement before continuing substantial work.

## Product Intent

- Build an extremely simple single-user RSS reader web app.
- Prioritize readability, maintainability, and YAGNI over cleverness or premature optimization.
- The app is internal/personal-use, but login is still required.
- The system should handle roughly 10k feeds, 10M stored stories, and around 1k new stories per day.
- Stories are stored forever.
- Fever API is explicitly out of scope for v1.

## User-Facing Features Agreed For v1

- Web app only.
- Single-pane reader UI.
- Endless cursor-based pagination.
- Show unread items and all items.
- Show starred items.
- Show unread/all items for a specific feed.
- Show unread/all items for a specific folder.
- Search items.
- Feed list page / feed management surface.
- Folder/group support.
- OPML import and export.
- Keyboard shortcuts.
- Inline story expansion with accordion-like behavior.

## Reader UI Behavior

- The UI should visually resemble a terminal/TUI application rather than a conventional dashboard.
- Collapsed story rows show feed name and story title.
- Expanded story view shows as much extracted feed data as available.
- Expanded view should include full title, human-readable publication date when available, author when available, and actions for read/unread and star.
- Only one story may be expanded at a time.
- Marking a story as read should not remove it from the list; it should visually fade.
- Expanding a story should scroll it to the top of the viewport.
- Expanded-story scrolling should account for the row gap/border so the result looks intentional rather than flush.
- When navigating between stories, an open story should transfer its expanded state to the next or previous selected story.
- Reader keyboard shortcuts for v1:
  - `j` / `ArrowDown` moves to the next story
  - next page should auto-load when the last collapsed story row enters the viewport (not only when keyboard navigation reaches the loaded end)
  - `k` / `ArrowUp` moves to the previous story
  - `Enter` / `o` toggles expansion on the selected story
  - `m` toggles read/unread on the selected story
  - `s` toggles starred on the selected story
  - `/` focuses the search field
  - `u` switches to unread view
  - `a` switches to all-items view
- Sorting is by `published_at`.
- If `published_at` is missing, store `null`, notify via summary, and learn from real data before adding more logic.

## Auth and User Model

- Exactly one local user in practice.
- The app should support an initial bootstrap/setup flow so the user can create the local account.
- No multi-user design.
- No public registration after bootstrap.
- No OAuth.
- No password reset in v1 unless later requested.

## Feed and Folder Model

- A feed belongs to exactly one folder in v1.
- Use a reasonable favicon extraction strategy in v1:
  - prefer feed-provided icon/image metadata when available
  - otherwise try common favicon paths and homepage icon links
  - do not build a fully general favicon crawler
- Duplicate feeds during OPML import are skipped silently.
- OPML export should preserve the current folder structure and include disabled feeds.
- Manual feed controls needed in admin for v1:
  - add folder
  - edit folder
  - delete folder
  - add feed
  - edit feed
  - delete feed
  - assign folder
  - inspect last fetch status
  - inspect consecutive failures
  - import/export OPML

## Story and Metadata Model

- Stories are immutable after ingest.
- Single-user local state should live directly on `items` to reduce table count and joins.
- No cross-feed deduplication.
- Store as much metadata as can be extracted from RSS/Atom without fetching original article pages.
- Normalize common fields that are queried or rendered often.
- Store source-specific extension metadata in `jsonb`.
- Include support for YouTube/iTunes metadata via pragmatic extension storage, not giant custom schemas.
- Keep feed-provided HTML content, but sanitize it at render time.
- Do not fetch original web pages for content in v1.
- Store item state fields directly on `items`:
  - `is_read`
  - `read_at`
  - `is_starred`
  - `starred_at`

## Item Identity Rules

- Prefer feed-provided identifiers.
- If `guid` is broken or missing, fall back to a deterministic hash of:
  - `feed_id`
  - normalized link
  - title
  - published_at

## Search

- Use PostgreSQL full-text search in v1.
- No fuzzy matching in v1.
- Search scope should cover the core item content surface; exact field breakdown can be refined during implementation, but the expectation is standard item search rather than feed-management search only.

## Fetching Rules

- Use a separate worker process for fetching and ingest.
- Start with an hourly fetch interval per feed.
- Use adaptive scheduling:
  - increase interval when feeds are inactive
  - back off when errors repeat
  - continue retrying forever unless manually disabled
- Use conditional requests wherever possible:
  - `ETag`
  - `Last-Modified`
- Use generous but finite timeouts.
- Cap concurrency globally.
- HTML scraping fallback is out of scope for now.

## Error Handling and Notifications

- Fetching should be highly intolerant to errors from an observability standpoint.
- Telegram notifications go only to the project owner.
- Notifications may be intentionally noisy; prioritize surfacing failures early over reducing alert volume.
- Notifications should be sent every fetch cycle.
- Failure details do not need aggressive deduplication or suppression.
- Primary alert categories the user cares about:
  - network errors
  - parsing errors
- Repeated identical failures do not need deduplication inside the summaries.
- Missing `published_at` should also be surfaced in summaries.
- Telegram summary formatting should be operator-friendly:
  - grouped by status/error category (for example `error/network`, `error/parse`, `not_modified`)
  - include feed title when available, fallback to feed URL
  - cap detail lines per cycle and include a `+N more` tail when truncated

## API and Contract Strategy

- The frontend should use the public API only.
- REST only in v1.
- OpenAPI is required.
- OpenAPI is used to generate frontend types and validation artifacts.
- `zod` generation from the OpenAPI contract is desired.
- Runtime response validation in the web app should happen at the API boundary using shared contract schemas from `packages/contracts`.
- Fever API is explicitly deferred.

## Stack Decisions

- Frontend: React.
- Backend API: Express.
- Database: PostgreSQL.
- Deployment shape: several Docker containers is acceptable.
- Architecture shape:
  - one React frontend app
  - one Express API app
  - one worker app
  - one PostgreSQL database
  - one small shared database package for migrations/schema assets used by API and worker
- Prefer a monorepo unless future requirements justify splitting it.

## Engineering Style

- Readability over speed and wow-effect.
- Keep the architecture clean and aggressively YAGNI.
- Prefer boring, explicit code over abstraction-heavy designs.
- Avoid premature generalization for multi-user, distributed systems, or plugin-style extensibility.
- Prefer append-only history where it improves debugging and operational clarity.
- Avoid introducing infrastructure that is not required by the current scope.
- On the frontend, favor a terminal/TUI visual language:
  - text-first layout
  - restrained palette
  - dense information display
  - keyboard-friendly interaction
  - avoid glossy dashboard styling

## Testing Strategy

- Test as much as reasonably possible.
- Heavy unit tests around:
  - feed parsing and normalization
  - error categorization
  - scheduling/backoff behavior
  - dedupe key generation
  - pagination
  - search behavior
- Integration tests around:
  - database behavior
  - fetcher behavior
  - ingest flow
  - OPML import/export
  - auth/session flow
- Minimal UI tests, focused on important behavior rather than exhaustive coverage.
- Prefer recorded feed fixtures over live network tests.

## Current Architectural Direction

- Keep the system intentionally simple:
  - `apps/web`
  - `apps/api`
  - `apps/worker`
  - `packages/contracts`
  - `packages/db`
  - optional small shared package only if duplication appears beyond contracts/db concerns
- Database schema changes should use versioned migrations tracked in a `schema_migrations` table, with explicit `.up.sql` / `.down.sql` files and `up/down/status` commands.
- Use cursor/keyset pagination, not offset pagination, for story listing.
- Build the internal product API first; Fever compatibility may be added later as a compatibility layer if needed.
- Maintain a separate admin page rather than overloading the reader UI with management concerns.

## Working Rule

- If the user changes a requirement, revises a decision, or explicitly accepts a new tradeoff, update this file before proceeding with substantial implementation that depends on that change.
