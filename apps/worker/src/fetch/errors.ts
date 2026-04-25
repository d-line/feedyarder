import type { FetchErrorCategory } from "./types.js";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const networkErrorNames = new Set([
  "AbortError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "TypeError"
]);

export function categorizeFetchError(error: unknown): FetchErrorCategory {
  if (error instanceof ParseError) {
    return "parse";
  }

  if (error instanceof Error && networkErrorNames.has(error.name)) {
    return "network";
  }

  return "network";
}
