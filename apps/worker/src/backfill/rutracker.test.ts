import { describe, expect, it } from "vitest";

import { parseRutrackerForumPage } from "./rutracker.js";

describe("parseRutrackerForumPage", () => {
  it("extracts forum topics and pagination metadata", () => {
    const page = parseRutrackerForumPage(
      `
        <html>
          <body>
            <table>
              <tr class="hl-tr">
                <td><a class="torTopic bold tt-text" href="./viewtopic.php?t=12345">First topic</a></td>
                <td><a href="./profile.php?mode=viewprofile&amp;u=10">poster</a></td>
                <td>2024-04-13 02:08</td>
              </tr>
              <tr class="hl-tr">
                <td><a class="torTopic" href="/forum/viewtopic.php?t=67890&amp;start=20">Second topic</a></td>
                <td>no date</td>
              </tr>
            </table>
            <div class="nav">
              <a href="./viewforum.php?f=1702">1</a>
              <a href="./viewforum.php?f=1702&amp;start=50">2</a>
              <a href="./viewforum.php?f=1702&amp;start=100">3</a>
              <a href="./viewforum.php?f=1702&amp;start=22200">445</a>
              <a href="./viewforum.php?f=1702&amp;start=22250">446</a>
              <a href="./viewforum.php?f=1702&amp;start=22300">447</a>
            </div>
          </body>
        </html>
      `,
      "https://rutracker.org/forum/viewforum.php?f=1702",
      "feed-id"
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      author: "poster",
      guid: "rutracker-topic:12345",
      publishedAt: "2024-04-13T02:08:00.000Z",
      title: "First topic",
      url: "https://rutracker.org/forum/viewtopic.php?t=12345"
    });
    expect(page.items[1]).toMatchObject({
      guid: "rutracker-topic:67890",
      publishedAt: null,
      title: "Second topic",
      url: "https://rutracker.org/forum/viewtopic.php?t=67890"
    });
    expect(page.pageSize).toBe(50);
    expect(page.maxStart).toBe(22300);
  });
});
