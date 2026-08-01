import type { Pool } from "pg";

export interface ItemListFilters {
  cursor: string | null;
  feedId: string | null;
  folderId: string | null;
  limit: number;
  query: string | null;
  read: boolean | null;
  starred: boolean | null;
}

export interface ItemRow {
  id: string;
  feed_id: string;
  feed_title: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summary_text: string | null;
  content_html: string | null;
  published_at: Date | null;
  raw_extension_data: unknown;
  is_read: boolean;
  is_starred: boolean;
  created_at: Date;
}

interface CursorPayload {
  id: string;
  publishedAt: string | null;
}

export interface ItemResponse {
  id: string;
  feedId: string;
  feedTitle: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summaryText: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
  media: ItemMediaResponse;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
}

export interface ItemMediaResponse {
  kind: "audio" | "podcast" | "youtube" | null;
  playerUrl: string | null;
  enclosureUrl: string | null;
  mimeType: string | null;
  durationSeconds: number | null;
  imageUrl: string | null;
}

export interface ItemListResponse {
  items: ItemResponse[];
  nextCursor: string | null;
}

export function mapItem(row: ItemRow): ItemResponse {
  const mediaDescription = readMediaDescription(row.raw_extension_data);

  return {
    author: row.author,
    contentHtml: row.content_html,
    createdAt: row.created_at.toISOString(),
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    id: row.id,
    isRead: row.is_read,
    isStarred: row.is_starred,
    media: mapItemMedia(row),
    publishedAt: row.published_at?.toISOString() ?? null,
    summaryText: row.summary_text ?? mediaDescription,
    title: row.title,
    url: row.url
  };
}

export async function listItems(
  pool: Pool,
  filters: ItemListFilters
): Promise<ItemListResponse> {
  const conditions: string[] = [];
  const values: Array<boolean | number | string> = [];
  let queryIndex: number | null = null;

  if (filters.feedId) {
    values.push(filters.feedId);
    conditions.push(`items.feed_id = $${values.length}`);
  }

  if (filters.folderId) {
    values.push(filters.folderId);
    conditions.push(`feeds.folder_id = $${values.length}`);
  }

  if (filters.read !== null) {
    values.push(filters.read);
    conditions.push(`items.is_read = $${values.length}`);
  }

  if (filters.starred !== null) {
    values.push(filters.starred);
    conditions.push(`items.is_starred = $${values.length}`);
  }

  if (filters.query) {
    values.push(filters.query);
    queryIndex = values.length;
  }

  appendCursorCondition(conditions, values, filters.cursor);

  values.push(filters.limit + 1);
  const limitIndex = values.length;
  const whereClause =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const sql =
    queryIndex === null
      ? `
        select
          items.id,
          items.feed_id,
          feeds.title as feed_title,
          items.title,
          items.url,
          items.author,
          items.summary_text,
          items.content_html,
          items.published_at,
          items.raw_extension_data,
          items.is_read,
          items.is_starred,
          items.created_at
        from items
        join feeds on feeds.id = items.feed_id
        ${whereClause}
        order by items.published_at desc nulls last, items.id desc
        limit $${limitIndex}
      `
      : `
        select *
        from (
          select
            items.id,
            items.feed_id,
            feeds.title as feed_title,
            items.title,
            items.url,
            items.author,
            items.summary_text,
            items.content_html,
            items.published_at,
            items.raw_extension_data,
            items.is_read,
            items.is_starred,
            items.created_at
          from items
          join feeds on feeds.id = items.feed_id
          ${appendSearchCondition(whereClause, itemSearchCondition(queryIndex))}

          union

          select
            items.id,
            items.feed_id,
            feeds.title as feed_title,
            items.title,
            items.url,
            items.author,
            items.summary_text,
            items.content_html,
            items.published_at,
            items.raw_extension_data,
            items.is_read,
            items.is_starred,
            items.created_at
          from items
          join feeds on feeds.id = items.feed_id
          ${appendSearchCondition(whereClause, feedSearchCondition(queryIndex))}
        ) matching_items
        order by published_at desc nulls last, id desc
        limit $${limitIndex}
      `;

  const result = await pool.query<ItemRow>(sql, values);

  const hasMore = result.rows.length > filters.limit;
  const pageRows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
  const lastRow = pageRows.at(-1);

  return {
    items: pageRows.map(mapItem),
    nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null
  };
}

function appendSearchCondition(whereClause: string, searchCondition: string): string {
  if (!whereClause) {
    return `where ${searchCondition}`;
  }

  return `${whereClause} and ${searchCondition}`;
}

function itemSearchCondition(queryIndex: number): string {
  return `to_tsvector(
    'simple',
    coalesce(items.title, '') || ' ' ||
    coalesce(items.summary_text, '') || ' ' ||
    coalesce(items.content_html, '') || ' ' ||
    coalesce(items.author, '')
  ) @@ plainto_tsquery('simple', $${queryIndex})`;
}

function feedSearchCondition(queryIndex: number): string {
  return `to_tsvector('simple', coalesce(feeds.title, '')) @@ plainto_tsquery('simple', $${queryIndex})`;
}

export async function updateItemState(
  pool: Pool,
  itemId: string,
  input: {
    isRead: boolean | null;
    isStarred: boolean | null;
  }
): Promise<ItemResponse | null> {
  const result = await pool.query<ItemRow>(
    `
      update items
      set
        is_read = coalesce($2, is_read),
        read_at = case
          when $2 is null then read_at
          when $2 = true then now()
          else null
        end,
        is_starred = coalesce($3, is_starred),
        starred_at = case
          when $3 is null then starred_at
          when $3 = true then now()
          else null
        end
      from feeds
      where items.id = $1
        and feeds.id = items.feed_id
      returning
        items.id,
        items.feed_id,
        feeds.title as feed_title,
        items.title,
        items.url,
        items.author,
        items.summary_text,
        items.content_html,
        items.published_at,
        items.raw_extension_data,
        items.is_read,
        items.is_starred,
        items.created_at
    `,
    [itemId, input.isRead, input.isStarred]
  );

  const row = result.rows[0];
  return row ? mapItem(row) : null;
}

function mapItemMedia(row: ItemRow): ItemMediaResponse {
  const extensions = readObject(row.raw_extension_data) ?? {};
  const youtubeVideoId = readText(extensions["yt:videoId"]) ?? extractYoutubeVideoId(row.url);
  const enclosure = readObject(extensions.enclosure);
  const enclosureUrl = normalizeUrl(readText(enclosure?.["@_url"]) ?? readText(enclosure?.url));
  const enclosureType = normalizeText(readText(enclosure?.["@_type"]) ?? readText(enclosure?.type));
  const mediaGroup = readObject(extensions["media:group"]);
  const imageUrl =
    readMediaThumbnailUrl(mediaGroup?.["media:thumbnail"]) ??
    readMediaThumbnailUrl(extensions["media:thumbnail"]) ??
    normalizeUrl(readText(readObject(extensions["itunes:image"])?.["@_href"]));
  const durationSeconds =
    parseDurationSeconds(readText(extensions["itunes:duration"])) ??
    parseDurationSeconds(readText(readObject(mediaGroup?.["yt:duration"])?.["@_seconds"])) ??
    parseDurationSeconds(readText(mediaGroup?.["yt:duration"]));

  if (youtubeVideoId) {
    return {
      durationSeconds,
      enclosureUrl: null,
      imageUrl,
      kind: "youtube",
      mimeType: null,
      playerUrl: `https://www.youtube-nocookie.com/embed/${youtubeVideoId}`
    };
  }

  if (enclosureUrl && enclosureType?.startsWith("audio/")) {
    return {
      durationSeconds,
      enclosureUrl,
      imageUrl,
      kind: extensions["itunes:duration"] || extensions["itunes:image"] ? "podcast" : "audio",
      mimeType: enclosureType,
      playerUrl: null
    };
  }

  return emptyItemMedia();
}

function readMediaDescription(rawExtensionData: unknown): string | null {
  const extensions = readObject(rawExtensionData);
  const mediaGroup = readObject(extensions?.["media:group"]);

  return normalizeText(
    readText(mediaGroup?.["media:description"]) ?? readText(extensions?.["media:description"])
  );
}

function emptyItemMedia(): ItemMediaResponse {
  return {
    durationSeconds: null,
    enclosureUrl: null,
    imageUrl: null,
    kind: null,
    mimeType: null,
    playerUrl: null
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function readText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object" && "#text" in value) {
    return readText((value as Record<string, unknown>)["#text"]);
  }

  if (value && typeof value === "object" && "__cdata" in value) {
    return readText((value as Record<string, unknown>).__cdata);
  }

  return null;
}

function normalizeText(value: string | null): string | null {
  return value?.trim() || null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function readMediaThumbnailUrl(value: unknown): string | null {
  for (const thumbnail of readArray(value)) {
    const thumbnailObject = readObject(thumbnail);
    const url = normalizeUrl(
      readText(thumbnailObject?.["@_url"]) ??
        readText(thumbnailObject?.url) ??
        readText(thumbnail)
    );

    if (url) {
      return url;
    }
  }

  return null;
}

function extractYoutubeVideoId(value: string | null): string | null {
  const url = normalizeUrl(value);

  if (!url) {
    return null;
  }

  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return sanitizeYoutubeVideoId(parsed.pathname.slice(1));
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    return (
      sanitizeYoutubeVideoId(parsed.searchParams.get("v")) ??
      sanitizeYoutubeVideoId(parsed.pathname.match(/\/(?:embed|shorts)\/([^/?#]+)/)?.[1] ?? null)
    );
  }

  return null;
}

function sanitizeYoutubeVideoId(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_-]{6,}$/.test(value)) {
    return null;
  }

  return value;
}

function parseDurationSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const parts = value.split(":").map((part) => Number(part));

  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function appendCursorCondition(
  conditions: string[],
  values: Array<boolean | number | string>,
  cursor: string | null
): void {
  if (!cursor) {
    return;
  }

  const decoded = decodeCursor(cursor);

  if (!decoded) {
    return;
  }

  if (decoded.publishedAt === null) {
    values.push(decoded.id);
    conditions.push(`items.published_at is null and items.id < $${values.length}`);
    return;
  }

  values.push(decoded.publishedAt);
  const publishedAtIndex = values.length;
  values.push(decoded.id);
  const idIndex = values.length;

  conditions.push(
    `(items.published_at < $${publishedAtIndex}::timestamptz or (items.published_at = $${publishedAtIndex}::timestamptz and items.id < $${idIndex}) or items.published_at is null)`
  );
}

function encodeCursor(row: ItemRow): string {
  const payload: CursorPayload = {
    id: row.id,
    publishedAt: row.published_at?.toISOString() ?? null
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<CursorPayload>;

    if (typeof parsed.id !== "string") {
      return null;
    }

    if (parsed.publishedAt !== null && typeof parsed.publishedAt !== "string") {
      return null;
    }

    return {
      id: parsed.id,
      publishedAt: parsed.publishedAt ?? null
    };
  } catch {
    return null;
  }
}
