import { describe, expect, it } from "vitest";

import { categorizeFetchError, ParseError } from "./errors.js";

describe("categorizeFetchError", () => {
  it("returns parse for parser failures", () => {
    expect(categorizeFetchError(new ParseError("Bad XML"))).toBe("parse");
  });

  it("returns network for abort-like failures", () => {
    const error = new Error("timed out");
    error.name = "AbortError";

    expect(categorizeFetchError(error)).toBe("network");
  });

  it("defaults unknown failures to network", () => {
    expect(categorizeFetchError(new Error("boom"))).toBe("network");
  });
});
