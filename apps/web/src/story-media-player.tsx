import { type Item } from "@feedyarder/contracts";

import { VisibleMediaSlot } from "./visible-media-slot.js";

interface StoryMediaPlayerProps {
  media: Item["media"];
  title: string;
}

export function StoryMediaPlayer({ media, title }: StoryMediaPlayerProps) {
  if (!media.kind) {
    return null;
  }

  return (
    <section className="story-media" aria-label={`${media.kind} media`}>
      <div className="story-media-header">
        <span>{media.kind}</span>
        {media.durationSeconds !== null ? <span>{formatDuration(media.durationSeconds)}</span> : null}
      </div>
      <VisibleMediaSlot>
        {media.kind === "youtube" && media.playerUrl ? (
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="story-video-player"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={media.playerUrl}
            title={title}
          />
        ) : null}
        {(media.kind === "podcast" || media.kind === "audio") && media.enclosureUrl ? (
          <div className="story-audio-shell">
            {media.imageUrl ? <img alt="" className="story-media-image" src={media.imageUrl} /> : null}
            <audio controls preload="metadata" src={media.enclosureUrl}>
              <a href={media.enclosureUrl}>open audio</a>
            </audio>
          </div>
        ) : null}
      </VisibleMediaSlot>
    </section>
  );
}

function formatDuration(value: number): string {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`;
  }

  return `${minutes}:${padTime(seconds)}`;
}

function padTime(value: number): string {
  return value.toString().padStart(2, "0");
}
