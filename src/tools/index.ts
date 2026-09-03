import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCheckAvailability } from "./check-availability.js";
import { registerGetHotelDetails } from "./get-hotel-details.js";
import { registerResolveDestination } from "./resolve-destination.js";
import { registerSearchHotels } from "./search-hotels.js";
import type { ToolDependencies } from "./tool.types.js";

export function registerHotelTools(server: McpServer, dependencies: ToolDependencies): void {
  registerResolveDestination(server, dependencies);
  registerSearchHotels(server, dependencies);
  registerGetHotelDetails(server, dependencies);
  registerCheckAvailability(server, dependencies);
}
