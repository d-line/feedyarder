// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { sanitizeFeedHtml } from "./sanitize-feed-html.js";

describe("sanitizeFeedHtml", () => {
  it("removes unsafe tags and attributes", () => {
    const sanitized = sanitizeFeedHtml(
      `<div style="color:red">
        hello
        <script>alert("x")</script>
        <img src="https://example.com/image.png" onerror="alert(1)" />
        <iframe src="https://example.com/embed"></iframe>
      </div>`
    );

    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onerror=");
    expect(sanitized).not.toContain("style=");
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).toContain("hello");
    expect(sanitized).toContain("<img");
  });

  it("keeps safe content markup", () => {
    const sanitized = sanitizeFeedHtml(
      `<p><a href="https://example.com/post">open post</a> and <strong>read</strong></p>`
    );

    expect(sanitized).toContain("<p>");
    expect(sanitized).toContain("<a href=\"https://example.com/post\">open post</a>");
    expect(sanitized).toContain("<strong>read</strong>");
  });
});
