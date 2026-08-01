import { describe, expect, it } from "vitest";

import { calculateSimilarityRetryDelayMilliseconds } from "./repository.js";

describe("similarity repository", () => {
  it("backs off retries exponentially and caps them at 24 hours", () => {
    expect(calculateSimilarityRetryDelayMilliseconds(1)).toBe(60_000);
    expect(calculateSimilarityRetryDelayMilliseconds(2)).toBe(120_000);
    expect(calculateSimilarityRetryDelayMilliseconds(10)).toBe(30_720_000);
    expect(calculateSimilarityRetryDelayMilliseconds(20)).toBe(86_400_000);
  });
});
