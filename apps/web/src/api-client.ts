import {
  errorResponseSchema,
  fetchEventListResponseSchema,
  feedDiscoveryResponseSchema,
  feedListResponseSchema,
  feedResponseSchema,
  folderListResponseSchema,
  folderResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  opmlImportResponseSchema,
  setupStatusResponseSchema,
  userResponseSchema,
  type ErrorResponse,
  type Feed,
  type FeedDiscoveryResult,
  type FetchEvent,
  type Folder,
  type Item,
  type ItemListResponse,
  type OpmlImportResponse,
  type User
} from "@feedyarder/contracts";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

interface ApiSchema<T> {
  parse: (input: unknown) => T;
}

interface ApiRequestOptions<T> extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  schema?: ApiSchema<T>;
}

export interface ListItemsInput {
  cursor?: string | null;
  feedId?: string;
  folderId?: string;
  limit: number;
  q?: string;
  read?: boolean;
  starred?: boolean;
}

export function getApiErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof (error as ErrorResponse).error?.message === "string"
  ) {
    return (error as ErrorResponse).error?.message ?? "Unexpected API error.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

export function isApiErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    (error as ErrorResponse).error?.code === code
  );
}

export async function fetchSetupStatus(): Promise<{ setupCompleted: boolean }> {
  return apiRequest("/setup/status", {
    schema: setupStatusResponseSchema
  });
}

export async function setupUser(input: {
  password: string;
  username: string;
}): Promise<User> {
  return apiRequest("/setup", {
    body: JSON.stringify(input),
    method: "POST",
    schema: userResponseSchema
  });
}

export async function login(input: {
  password: string;
  username: string;
}): Promise<User> {
  return apiRequest("/session", {
    body: JSON.stringify(input),
    method: "POST",
    schema: userResponseSchema
  });
}

export async function logout(): Promise<void> {
  await apiRequest("/session", {
    method: "DELETE"
  });
}

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest("/me", {
      schema: userResponseSchema
    });
  } catch (error) {
    if (isApiErrorCode(error, "not_authenticated")) {
      return null;
    }

    throw error;
  }
}

export async function listFolders(): Promise<Folder[]> {
  return apiRequest("/folders", {
    schema: folderListResponseSchema
  });
}

export async function createFolder(input: {
  position: number;
  title: string;
}): Promise<Folder> {
  return apiRequest("/folders", {
    body: JSON.stringify(input),
    method: "POST",
    schema: folderResponseSchema
  });
}

export async function updateFolder(
  folderId: string,
  input: {
    position: number;
    title: string;
  }
): Promise<Folder> {
  return apiRequest(`/folders/${folderId}`, {
    body: JSON.stringify(input),
    method: "PATCH",
    schema: folderResponseSchema
  });
}

export async function deleteFolder(folderId: string): Promise<void> {
  await apiRequest(`/folders/${folderId}`, {
    method: "DELETE"
  });
}

export async function listFeeds(): Promise<Feed[]> {
  return apiRequest("/feeds", {
    schema: feedListResponseSchema
  });
}

export async function discoverFeeds(url: string): Promise<FeedDiscoveryResult> {
  return apiRequest("/feeds/discover", {
    body: JSON.stringify({ url }),
    method: "POST",
    schema: feedDiscoveryResponseSchema
  });
}

export async function createFeed(input: {
  feedUrl: string;
  folderId: string | null;
  siteUrl: string | null;
  title: string | null;
}): Promise<Feed> {
  return apiRequest("/feeds", {
    body: JSON.stringify(input),
    method: "POST",
    schema: feedResponseSchema
  });
}

export async function updateFeed(
  feedId: string,
  input: {
    feedUrl?: string;
    folderId?: string | null;
    isPaused?: boolean;
    siteUrl?: string | null;
    title?: string | null;
  }
): Promise<Feed> {
  return apiRequest(`/feeds/${feedId}`, {
    body: JSON.stringify(input),
    method: "PATCH",
    schema: feedResponseSchema
  });
}

export async function retryFeed(feedId: string): Promise<Feed> {
  return apiRequest(`/feeds/${feedId}/retry`, {
    method: "POST",
    schema: feedResponseSchema
  });
}

export async function deleteFeed(feedId: string): Promise<void> {
  await apiRequest(`/feeds/${feedId}`, {
    method: "DELETE"
  });
}

export async function listFetchEvents(limit: number): Promise<FetchEvent[]> {
  return apiRequest(`/fetch-events?limit=${limit}`, {
    schema: fetchEventListResponseSchema
  });
}

export async function listItems(input: ListItemsInput): Promise<ItemListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  if (input.feedId) {
    params.set("feedId", input.feedId);
  }

  if (input.folderId) {
    params.set("folderId", input.folderId);
  }

  if (input.read !== undefined) {
    params.set("read", String(input.read));
  }

  if (input.starred !== undefined) {
    params.set("starred", String(input.starred));
  }

  if (input.q) {
    params.set("q", input.q);
  }

  return apiRequest(`/items?${params.toString()}`, {
    schema: itemListResponseSchema
  });
}

export async function updateItemState(
  itemId: string,
  input: {
    isRead?: boolean;
    isStarred?: boolean;
  }
): Promise<Item> {
  return apiRequest(`/items/${itemId}/state`, {
    body: JSON.stringify(input),
    method: "PATCH",
    schema: itemResponseSchema
  });
}

export async function importOpml(opml: string): Promise<OpmlImportResponse> {
  return apiRequest("/opml/import", {
    body: JSON.stringify({
      opml
    }),
    method: "POST",
    schema: opmlImportResponseSchema
  });
}

export async function exportOpml(): Promise<string> {
  return apiTextRequest("/opml/export");
}

async function apiRequest<T>(path: string, options?: ApiRequestOptions<T>): Promise<T> {
  const { schema, ...init } = options ?? {};
  const headers = new Headers(init.headers);

  if (options?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    credentials: "include",
    ...init,
    headers
  };

  if (options?.body !== undefined) {
    requestInit.body = options.body;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, requestInit);

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(data);

    if (parsedError.success) {
      throw parsedError.data;
    }

    throw data;
  }

  if (schema) {
    return schema.parse(data);
  }

  return data as T;
}

async function apiTextRequest(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init
  });

  const text = await response.text();

  if (!response.ok) {
    let parsed: unknown = text;

    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep plain text as-is.
    }

    throw parsed;
  }

  return text;
}
