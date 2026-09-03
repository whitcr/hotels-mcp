import type { HotelsApiClient } from "../clients/hotels-api.client.js";

export interface ToolDependencies {
  client: HotelsApiClient;
  maxResults: number;
  hotelPublicBaseUrl: string;
}
