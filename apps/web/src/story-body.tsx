import { sanitizeFeedHtml } from "./sanitize-feed-html.js";

interface StoryBodyProps {
  contentHtml: string | null;
  summaryText: string | null;
}

export function StoryBody({ contentHtml, summaryText }: StoryBodyProps) {
  if (contentHtml) {
    return (
      <div
        className="story-body story-body-html"
        dangerouslySetInnerHTML={{ __html: sanitizeFeedHtml(contentHtml) }}
      />
    );
  }

  return <pre className="story-body story-body-text">{summaryText ?? "No content."}</pre>;
}
