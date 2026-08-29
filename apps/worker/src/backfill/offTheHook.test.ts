import { describe, expect, it } from "vitest";

import {
  isOffTheHookFeed,
  parseOffTheHookArchiveMonths,
  parseOffTheHookMonthPage,
  resolveOffTheHookArchiveUrl
} from "./offTheHook.js";

describe("Off The Hook backfill parser", () => {
  it("discovers every monthly archive URL from the year selectors", () => {
    const months = parseOffTheHookArchiveMonths(
      `
        <form action="../cgi-bin/redirect.cgi" method="get">
          <select name="redirect">
            <option value="../offthehook/1988/1088.html">October
          </select>
        </form>
        <form action="../cgi-bin/redirect.cgi" method="get">
          <select name="redirect">
            <option value="../offthehook/2026/0726.html">July
            <option value="../offthehook/2026/0826.html">August
            <option value="https://example.com/offthehook/2026/0926.html">External
          </select>
        </form>
      `,
      resolveOffTheHookArchiveUrl()
    );

    expect(months).toEqual([
      {
        title: "October",
        url: "https://www.2600.com/offthehook/1988/1088.html"
      },
      {
        title: "July",
        url: "https://www.2600.com/offthehook/2026/0726.html"
      },
      {
        title: "August",
        url: "https://www.2600.com/offthehook/2026/0826.html"
      }
    ]);
  });

  it("normalizes descriptions and selects the highest-bitrate main-show MP3", () => {
    const page = parseOffTheHookMonthPage(
      `
        <table><tr><td>
          <!--
            <font face="Comic Sans MS" size="+1">- 01 / 01 / 2025 -</font>
            <a href="../mp3files/2025/off_the_hook__20250101-128.mp3">Unavailable</a>
          -->
          <p><font face="Comic Sans MS" size="+1">- 01 / 08 / 2025 -</font>
          <p>
          The panel discusses old phone exchanges and <a href="https://example.com/notes">listener notes</a>.
          <p><br>
          Overtime: a follow-up discussion.
          </font>
          <p><font face="Comic Sans MS" size="+1"><strong>Download It
          Now!</strong></font>
          <p><font face="Comic Sans MS" size="+1">January 8</font><br>
          <a href="../mp3files/2025/off_the_hook__20250108.mp3">Download</a><a href="../plsfiles/2025/off_the_hook__20250108.pls">Stream</a> 16k mp3<br>
          <a href="../mp3files/2025/off_the_hook__20250108-128.mp3">Download</a><a href="../plsfiles/2025/off_the_hook__20250108-128.pls">Stream</a> 128k mp3<br>
          <p><font>Off The Hook Overtime</font><br>
          <a href="../mp3files/2025/off_the_hook_overtime__20250108.mp3">Download</a> 16k mp3<br>
          <a href="../mp3files/2025/off_the_hook_overtime__20250108-128.mp3">Download</a> 128k mp3<br>
          <p><font face="Comic Sans MS" size="+1">- 01 / 15 / 2025 -</font>
          <p>Second episode description.</font>
          <p><font face="Comic Sans MS" size="+1"><strong>Download It Now!</strong></font>
          <p><font face="Comic Sans MS" size="+1">January 15</font><br>
          <a href="../mp3files/2025/off_the_hook__20250115.mp3">Download</a> 16k mp3<br>
          <a href="../mp3files/2025/off_the_hook__20250115-128.mp3">Download</a> 128k mp3<br>
        </td></tr></table>
      `,
      "https://www.2600.com/offthehook/2025/0125.html",
      "feed-1"
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        author: null,
        guid: "oth20250108-hq",
        publishedAt: "2025-01-08T00:00:00.000Z",
        summaryText:
          "The panel discusses old phone exchanges and listener notes . Overtime: a follow-up discussion.",
        title: "Off The Hook - January 8, 2025",
        url: "https://www.2600.com/offthehook/2025/0125.html"
      })
    );
    expect(page.items[0]?.contentHtml).toContain("listener notes");
    expect(page.items[0]?.rawExtensionData.enclosure).toEqual({
      "@_length": null,
      "@_type": "audio/mpeg",
      "@_url": "https://www.2600.com/offthehook/mp3files/2025/off_the_hook__20250108-128.mp3"
    });
    expect(page.items[0]?.rawExtensionData.offTheHook).toEqual(
      expect.objectContaining({
        bitrateKbps: 128,
        dateKey: "20250108",
        selectedAudioUrl:
          "https://www.2600.com/offthehook/mp3files/2025/off_the_hook__20250108-128.mp3"
      })
    );
    expect(
      (page.items[0]?.rawExtensionData.offTheHook as { audioFiles: unknown[] }).audioFiles
    ).toHaveLength(2);
  });

  it("uses the page year for two-digit archive dates and keeps multipart audio metadata", () => {
    const page = parseOffTheHookMonthPage(
      `
        <font face="Comic Sans MS" size="+1">- 10 / 07 / 88 -</font>
        <p>The first edition is presented in two parts.</font>
        <p><font face="Comic Sans MS" size="+1"><strong>Download It Now!</strong></font>
        <p>Part 1<br>
        <a href="../mp3files/1988/off_the_hook__19881007a.mp3">Download</a> 16k mp3<br>
        <a href="../mp3files/1988/off_the_hook__19881007a-128.mp3">Download</a> 128k mp3<br>
        <p>Part 2<br>
        <a href="../mp3files/1988/off_the_hook__19881007b.mp3">Download</a> 16k mp3<br>
        <a href="../mp3files/1988/off_the_hook__19881007b-128.mp3">Download</a> 128k mp3<br>
      `,
      "https://www.2600.com/offthehook/1988/1088.html",
      "feed-1"
    );

    expect(page.items[0]).toEqual(
      expect.objectContaining({
        guid: "oth19881007-hq",
        publishedAt: "1988-10-07T00:00:00.000Z"
      })
    );
    const metadata = page.items[0]?.rawExtensionData.offTheHook as {
      audioFiles: Array<{ bitrateKbps: number; part: string }>;
      selectedAudioUrl: string;
    };
    expect(metadata.audioFiles).toEqual([
      expect.objectContaining({ bitrateKbps: 16, part: "a" }),
      expect.objectContaining({ bitrateKbps: 128, part: "a" }),
      expect.objectContaining({ bitrateKbps: 16, part: "b" }),
      expect.objectContaining({ bitrateKbps: 128, part: "b" })
    ]);
    expect(metadata.selectedAudioUrl).toContain("off_the_hook__19881007a-128.mp3");
  });

  it("matches only the targeted RSS feed", () => {
    expect(isOffTheHookFeed("https://www.2600.com/oth-broadband.xml")).toBe(true);
    expect(isOffTheHookFeed("https://2600.com/oth-broadband.xml")).toBe(true);
    expect(isOffTheHookFeed("https://www.2600.com/offthehook/archive_ra.html")).toBe(false);
    expect(isOffTheHookFeed("https://example.com/oth-broadband.xml")).toBe(false);
  });
});
