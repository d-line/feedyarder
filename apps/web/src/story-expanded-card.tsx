import { type Item } from "@feedyarder/contracts";
import moment from "moment";

import { SimilarArticles } from "./similar-articles.js";
import { StoryBody } from "./story-body.js";
import { StoryMediaPlayer } from "./story-media-player.js";

interface StoryExpandedCardProps {
  item: Item;
  onSelectSimilar: (item: Item) => void;
  onToggleRead: (item: Item) => void;
  onToggleStar: (item: Item) => void;
}

export function StoryExpandedCard({
  item,
  onSelectSimilar,
  onToggleRead,
  onToggleStar
}: StoryExpandedCardProps) {
  return (
    <div className="story-expanded">
      <div className="story-meta">
        <span>pub:{formatItemTimestamp(item)}</span>
        <span>author:{item.author ?? "unknown"}</span>
        <span>read:{item.isRead ? "yes" : "no"}</span>
        <span>starred:{item.isStarred ? "yes" : "no"}</span>
      </div>
      {item.media.kind ? (
        <StoryMediaPlayer media={item.media} title={item.title ?? item.feedTitle ?? "media item"} />
      ) : null}
      <StoryBody contentHtml={item.contentHtml} summaryText={item.summaryText} />
      <SimilarArticles itemId={item.id} onSelectItem={onSelectSimilar} />
      <div className="story-actions">
        <button onClick={() => onToggleRead(item)} type="button">
          {item.isRead ? "mark unread" : "mark read"}
        </button>
        <button onClick={() => onToggleStar(item)} type="button">
          {item.isStarred ? "unstar" : "star"}
        </button>
        {item.url ? (
          <a className="story-link" href={item.url} rel="noreferrer" target="_blank">
            open source
          </a>
        ) : null}
        <span className="story-action-date">pub:{formatItemFullTimestamp(item)}</span>
      </div>
    </div>
  );
}

function formatRelativeTimestamp(value: string): string {
  return moment(value).fromNow();
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatItemTimestamp(item: Item): string {
  return item.publishedAt ? formatRelativeTimestamp(item.publishedAt) : "(no pub date)";
}

function formatItemFullTimestamp(item: Item): string {
  return item.publishedAt ? formatTimestamp(item.publishedAt) : "(no pub date)";
}
