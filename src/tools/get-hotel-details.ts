import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mapHotelDetails } from "../mappers/index.js";
import { getHotelDetailsInput, hotelDetailsListOutput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";

export function registerGetHotelDetails(server: McpServer, { client, hotelPublicBaseUrl }: ToolDependencies): void {
  server.registerTool("get_hotel_details", {
    title: "Get hotel details",
    description: "Get normalized public details for one or more Hotels24 hotels. Does not return partner contacts or internal fields.",
    inputSchema: getHotelDetailsInput,
    outputSchema: hotelDetailsListOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ hotel_ids, language }) => runTool(async () => ({
    hotels: mapHotelDetails(await client.getHotelDetails(hotel_ids, language), language, hotelPublicBaseUrl),
  })));
}
