import { z } from "zod";
import { schemas } from "./api.generated.js";

export const errorResponseSchema = schemas.ErrorResponse;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const setupStatusResponseSchema = schemas.SetupStatusResponse;
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const userResponseSchema = schemas.UserResponse;
export type User = z.infer<typeof userResponseSchema>;

export const folderResponseSchema = schemas.FolderResponse;
export const folderListResponseSchema = z.array(folderResponseSchema);
export type Folder = z.infer<typeof folderResponseSchema>;

export const feedResponseSchema = schemas.FeedResponse;
export const feedListResponseSchema = z.array(feedResponseSchema);
export type Feed = z.infer<typeof feedResponseSchema>;

export const feedDiscoveryResponseSchema = schemas.FeedDiscoveryResponse;
export type FeedDiscoveryResult = z.infer<typeof feedDiscoveryResponseSchema>;
export type DiscoveredFeed = FeedDiscoveryResult["feeds"][number];

export const fetchEventResponseSchema = schemas.FetchEventResponse;
export const fetchEventListResponseSchema = z.array(fetchEventResponseSchema);
export type FetchEvent = z.infer<typeof fetchEventResponseSchema>;

export const opmlImportResponseSchema = schemas.ImportOpmlResponse;
export type OpmlImportResponse = z.infer<typeof opmlImportResponseSchema>;

export const itemResponseSchema = schemas.ItemResponse;
export type Item = z.infer<typeof itemResponseSchema>;

export const itemListResponseSchema = schemas.ItemListResponse;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;

export const similarItemsResponseSchema = schemas.SimilarItemsResponse;
export type SimilarItemsResponse = z.infer<typeof similarItemsResponseSchema>;
