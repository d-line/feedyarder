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

interface ItemRow {
  id: string;
  feed_id: string;
  feed_title: string | null;
  title: string | null;
  url: string | null;
  author: string | null;
  summary_text: string | null;
  content_html: string | null;
  published_at: Date | null;
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
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
}

export interface ItemListResponse {
  items: ItemResponse[];
  nextCursor: string | null;
}

function mapItem(row: ItemRow): ItemResponse {
  return {
    author: row.author,
    contentHtml: row.content_html,
    createdAt: row.created_at.toISOString(),
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    id: row.id,
    isRead: row.is_read,
    isStarred: row.is_starred,
    publishedAt: row.published_at?.toISOString() ?? null,
    summaryText: row.summary_text,
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
    const queryIndex = values.length;
    conditions.push(
      `(
        to_tsvector(
          'simple',
          coalesce(items.title, '') || ' ' ||
          coalesce(items.summary_text, '') || ' ' ||
          coalesce(items.content_html, '') || ' ' ||
          coalesce(items.author, '')
        ) @@ plainto_tsquery('simple', $${queryIndex})
        or to_tsvector('simple', coalesce(feeds.title, '')) @@ plainto_tsquery('simple', $${queryIndex})
      )`
    );
  }

  appendCursorCondition(conditions, values, filters.cursor);

  values.push(filters.limit + 1);
  const limitIndex = values.length;
  const whereClause =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const result = await pool.query<ItemRow>(
    `
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
        items.is_read,
        items.is_starred,
        items.created_at
      from items
      join feeds on feeds.id = items.feed_id
      ${whereClause}
      order by items.published_at desc nulls last, items.id desc
      limit $${limitIndex}
    `,
    values
  );

  const hasMore = result.rows.length > filters.limit;
  const pageRows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
  const lastRow = pageRows.at(-1);

  return {
    items: pageRows.map(mapItem),
    nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null
  };
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
        items.is_read,
        items.is_starred,
        items.created_at
    `,
    [itemId, input.isRead, input.isStarred]
  );

  const row = result.rows[0];
  return row ? mapItem(row) : null;
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
