import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mapAvailability } from "../mappers/index.js";
import { availabilityOutput, checkAvailabilityInput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";

export function registerCheckAvailability(server: McpServer, { client }: ToolDependencies): void {
  server.registerTool("check_hotel_availability", {
    title: "Check hotel availability",
    description: "Recheck live room availability and UAH prices for one hotel before presenting or booking an option.",
    inputSchema: checkAvailabilityInput,
    outputSchema: availabilityOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => runTool(async () => {
    if (args.check_in >= args.check_out) throw new Error("check_out must be after check_in");
    const today = new Date().toISOString().slice(0, 10);
    if (args.check_in < today) throw new Error(`check_in must not be in the past; today is ${today}`);
    return {
      currency: "UAH",
      hotels: mapAvailability(await client.getAvailability({
        hotelIds: [args.hotel_id],
        checkIn: args.check_in,
        checkOut: args.check_out,
        guests: args.guests,
      })),
    };
  }));
}
