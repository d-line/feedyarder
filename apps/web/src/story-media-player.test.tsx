// @vitest-environment jsdom
import { type Item } from "@feedyarder/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoryMediaPlayer } from "./story-media-player.js";

describe("StoryMediaPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("uses the full-width container for YouTube media", async () => {
    await renderPlayer(root, youtubeMedia);

    expect(container.querySelector(".story-media")?.classList).toContain(
      "story-media-video"
    );
  });

  it("keeps audio media in the bounded container", async () => {
    await renderPlayer(root, audioMedia);

    expect(container.querySelector(".story-media")?.classList).not.toContain(
      "story-media-video"
    );
  });
});

async function renderPlayer(root: Root, media: Item["media"]): Promise<void> {
  await act(async () => {
    root.render(<StoryMediaPlayer media={media} title="Example media" />);
    await Promise.resolve();
  });
}

const youtubeMedia: Item["media"] = {
  durationSeconds: 120,
  enclosureUrl: null,
  imageUrl: null,
  kind: "youtube",
  mimeType: null,
  playerUrl: "https://www.youtube.com/embed/example"
};

const audioMedia: Item["media"] = {
  durationSeconds: 120,
  enclosureUrl: "https://example.com/audio.mp3",
  imageUrl: null,
  kind: "audio",
  mimeType: "audio/mpeg",
  playerUrl: null
};
