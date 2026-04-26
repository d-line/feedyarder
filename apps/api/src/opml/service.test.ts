import { describe, expect, it } from "vitest";

import { buildOpmlDocument, parseOpmlDocument } from "./service.js";

describe("opml service", () => {
  it("parses nested outlines, normalizes URLs, and skips duplicate xmlUrl entries", () => {
    const document = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="Tech">
      <outline text="Feed A" xmlUrl="https://example.com/a.xml" htmlUrl="https://example.com/a" />
      <outline title="Deep Folder">
        <outline text="Feed B" title="Feed B Custom" xmlUrl="https://example.com/b.xml" htmlUrl=" https://example.com/b " />
      </outline>
    </outline>
    <outline text="Other">
      <outline text="Feed A Duplicate" xmlUrl="https://example.com/a.xml" />
    </outline>
    <outline text="Standalone" xmlUrl="https://example.com/c.xml" />
  </body>
</opml>`;

    const parsed = parseOpmlDocument(document);

    expect(parsed).toEqual([
      {
        feedUrl: "https://example.com/a.xml",
        folderTitle: "Tech",
        siteUrl: "https://example.com/a",
        title: "Feed A"
      },
      {
        feedUrl: "https://example.com/b.xml",
        folderTitle: "Deep Folder",
        siteUrl: "https://example.com/b",
        title: "Feed B Custom"
      },
      {
        feedUrl: "https://example.com/c.xml",
        folderTitle: null,
        siteUrl: null,
        title: "Standalone"
      }
    ]);
  });

  it("throws for empty OPML documents and missing body", () => {
    expect(() => parseOpmlDocument("   ")).toThrow("OPML document is empty.");

    expect(() =>
      parseOpmlDocument(`<?xml version="1.0" encoding="UTF-8"?><opml version="1.0"></opml>`)
    ).toThrow("OPML body is missing.");
  });

  it("builds OPML with grouped and ungrouped feeds plus pause metadata", () => {
    const opml = buildOpmlDocument([
      {
        feedUrl: "https://example.com/ungrouped.xml",
        folderTitle: null,
        isPaused: false,
        siteUrl: null,
        title: "Ungrouped Feed"
      },
      {
        feedUrl: "https://example.com/grouped.xml",
        folderTitle: "News",
        isPaused: true,
        siteUrl: "https://example.com/grouped",
        title: "Grouped Feed"
      }
    ]);

    expect(opml).toContain("<opml");
    expect(opml).toContain("<title>Feedyarder Export</title>");
    expect(opml).toContain('text="News"');
    expect(opml).toContain('xmlUrl="https://example.com/grouped.xml"');
    expect(opml).toContain('htmlUrl="https://example.com/grouped"');
    expect(opml).toMatch(/feedyarderPaused(="true")?/);
    expect(opml).toContain('xmlUrl="https://example.com/ungrouped.xml"');
    expect(opml).toContain('feedyarderPaused="false"');
  });
});
