import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mapDestinations } from "../mappers/index.js";
import { resolveDestinationInput, resolveDestinationOutput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";

export function registerResolveDestination(server: McpServer, { client, maxResults }: ToolDependencies): void {
  server.registerTool("resolve_destination", {
    title: "Resolve hotel destination",
    description: "Resolve a customer-provided city or hotel name to Hotels24 IDs before searching availability. If the customer has not provided a city, ask for it first. If multiple plausible cities are returned, ask the customer to choose instead of guessing.",
    inputSchema: resolveDestinationInput,
    outputSchema: resolveDestinationOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ query, language }) => runTool(async () => ({
    destinations: mapDestinations(await client.resolveDestination(query, language), language).slice(0, maxResults),
  })));
}
