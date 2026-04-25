import { describe, expect, it } from "vitest";

import {
  calculateNextFetchIntervalMinutes,
  classifyFeedActivity
} from "./schedule.js";

describe("calculateNextFetchIntervalMinutes", () => {
  it("backs off after errors", () => {
    expect(
      calculateNextFetchIntervalMinutes({
        currentIntervalMinutes: 60,
        consecutiveErrorCount: 1,
        newItemCount: 0,
        status: "error"
      })
    ).toBe(120);
  });

  it("slowly increases polling for inactive feeds", () => {
    expect(
      calculateNextFetchIntervalMinutes({
        currentIntervalMinutes: 120,
        consecutiveErrorCount: 0,
        newItemCount: 0,
        status: "not_modified"
      })
    ).toBe(150);
  });

  it("moves active feeds back toward the baseline", () => {
    expect(
      calculateNextFetchIntervalMinutes({
        currentIntervalMinutes: 240,
        consecutiveErrorCount: 0,
        newItemCount: 3,
        status: "success"
      })
    ).toBe(180);
  });

  it("never drops below the one-hour floor", () => {
    expect(
      calculateNextFetchIntervalMinutes({
        currentIntervalMinutes: 60,
        consecutiveErrorCount: 0,
        newItemCount: 10,
        status: "success"
      })
    ).toBe(60);
  });
});

describe("classifyFeedActivity", () => {
  it("marks empty high-interval feeds as inactive", () => {
    expect(classifyFeedActivity(360, 0)).toBe("inactive");
  });

  it("marks feeds with new items as active", () => {
    expect(classifyFeedActivity(360, 1)).toBe("active");
  });
});
