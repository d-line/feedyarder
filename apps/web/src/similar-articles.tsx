import { useEffect, useState } from "react";
import {
  type Item,
  type SimilarItemsResponse
} from "@feedyarder/contracts";
import moment from "moment";

import { getApiErrorMessage, listSimilarItems } from "./api-client.js";

const responseCache = new Map<string, SimilarItemsResponse>();

interface SimilarArticlesProps {
  itemId: string;
  onSelectItem: (item: Item) => void;
}

export function SimilarArticles({
  itemId,
  onSelectItem
}: SimilarArticlesProps) {
  const [response, setResponse] = useState<SimilarItemsResponse | null>(
    () => responseCache.get(itemId) ?? null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!responseCache.has(itemId));

  useEffect(() => {
    const cached = responseCache.get(itemId);

    if (cached) {
      setResponse(cached);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setResponse(null);
    setErrorMessage(null);
    setIsLoading(true);

    void listSimilarItems(itemId, {
      limit: 5,
      signal: controller.signal
    })
      .then((result) => {
        if (result.status === "ready") {
          responseCache.set(itemId, result);
        }

        setResponse(result);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setErrorMessage(getApiErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [itemId]);

  if (isLoading) {
    return <p className="similar-articles-status">similar:scanning...</p>;
  }

  if (errorMessage) {
    return (
      <p className="similar-articles-status similar-articles-error">
        similar:error {errorMessage}
      </p>
    );
  }

  if (!response || response.status === "unavailable") {
    return null;
  }

  if (response.status === "pending") {
    return <p className="similar-articles-status">similar:indexing...</p>;
  }

  if (response.count === 0) {
    return null;
  }

  return (
    <details className="similar-articles">
      <summary>
        similar ({response.count}
        {response.hasMore ? "+" : ""})
      </summary>
      <div className="similar-articles-list">
        {response.items.map((item) => (
          <button
            className="similar-article"
            key={item.id}
            onClick={() => onSelectItem(item)}
            type="button"
          >
            <span className="similar-article-marker">&gt;</span>
            <span className="similar-article-feed">
              {item.feedTitle ?? "unknown-feed"}
            </span>
            <span className="similar-article-title">
              {item.title ?? "(untitled item)"}
            </span>
            <span className="similar-article-time">
              {item.publishedAt ? moment(item.publishedAt).fromNow() : "no date"}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
