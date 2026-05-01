import { describe, expect, it } from "vitest";

import {
  buildAdafruitPageUrl,
  parseAdafruitBlogPage,
  resolveAdafruitRootUrl
} from "./adafruit.js";

describe("parseAdafruitBlogPage", () => {
  it("normalizes Adafruit blog post rows", () => {
    const result = parseAdafruitBlogPage(
      `<html><body>
        <div class="container post-container">
          <div class="row post-row post-thumb-only post-656160 post type-post status-publish" id="post-656160">
            <div class="col-md-8 post-thumb-container">
              <a class="post-thumb" href="https://blog.adafruit.com/2026/04/29/glitch-image-generator/">
                <div style="background-image: url('https://cdn-blog.adafruit.com/uploads/2026/04/glitch.jpeg');"></div>
              </a>
            </div>
            <div class="col-md-4 post-meta">
              <div class="meta">
                <h3><time class="published" datetime="2026-04-29T20:00:58-04:00">April 29, 2026 AT&nbsp;8:00&nbsp;pm</time></h3>
                <a class="storytitle entry-title" href="https://blog.adafruit.com/2026/04/29/glitch-image-generator/" rel="bookmark">
                  Glitch Image Generator
                </a>
                <div class="byline">&#8212;&nbsp;by&nbsp;<a class="author vcard url fn" rel="author external" href="https://blog.adafruit.com/author/ben/">Ben</a></div>
              </div>
              <div class="bottom-meta">
                <div class="category-and-tags">
                  Filed under: <a href="https://blog.adafruit.com/category/art/" rel="category tag">art</a>, <a href="https://blog.adafruit.com/category/espressif/esp32/" rel="category tag">ESP32</a> &#8212;&nbsp;<br />
                  Tags: <a href="https://blog.adafruit.com/tag/art/" rel="tag">art</a>, <a href="https://blog.adafruit.com/tag/esp32/" rel="tag">ESP32</a> &#8212;
                </div>
              </div>
            </div>
          </div>
        </div>
      </body></html>`,
      "https://blog.adafruit.com/page/2/",
      "feed-id"
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          author: "Ben",
          guid: "adafruit-post:656160",
          publishedAt: "2026-04-30T00:00:58.000Z",
          rawExtensionData: {
            adafruit: {
              backfilledFrom: "https://blog.adafruit.com/page/2/",
              categories: ["art", "ESP32"],
              postId: "656160",
              tags: ["art", "ESP32"],
              thumbnailUrl: "https://cdn-blog.adafruit.com/uploads/2026/04/glitch.jpeg"
            }
          },
          summaryText: "Filed under: art, ESP32 — Tags: art, ESP32",
          title: "Glitch Image Generator",
          url: "https://blog.adafruit.com/2026/04/29/glitch-image-generator/"
        })
      ],
      pageNumber: 2
    });
  });
});

describe("buildAdafruitPageUrl", () => {
  it("builds root and numbered archive page URLs", () => {
    expect(buildAdafruitPageUrl("https://blog.adafruit.com/feed/", 1)).toBe(
      "https://blog.adafruit.com/"
    );
    expect(buildAdafruitPageUrl("https://blog.adafruit.com/feed/", 42)).toBe(
      "https://blog.adafruit.com/page/42/"
    );
  });
});

describe("resolveAdafruitRootUrl", () => {
  it("resolves any Adafruit blog URL to the blog root", () => {
    expect(resolveAdafruitRootUrl("https://blog.adafruit.com/feed/").toString()).toBe(
      "https://blog.adafruit.com/"
    );
  });
});
