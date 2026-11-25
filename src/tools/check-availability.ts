import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mapAvailability } from "../mappers/index.js";
import { availabilityOutput, checkAvailabilityInput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";
import { validateStayDates } from "./stay-dates.js";

export function registerCheckAvailability(server: McpServer, { client }: ToolDependencies): void {
  server.registerTool("check_hotel_availability", {
    title: "Check hotel availability",
    description: "Recheck live room availability and UAH prices for one hotel before presenting or booking an option.",
    inputSchema: checkAvailabilityInput,
    outputSchema: availabilityOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => runTool(async () => {
    validateStayDates(args.check_in, args.check_out);
    const nights = (Date.parse(args.check_out) - Date.parse(args.check_in)) / 86_400_000;
    const group = args.guests >= 6;
    const hotels = mapAvailability(await client.getAvailability({
      hotelIds: [args.hotel_id],
      checkIn: args.check_in,
      checkOut: args.check_out,
      guests: group ? 1 : args.guests,
      fresh: true,
    }), args.guests, group);
    return {
      currency: "UAH",
      hotels: hotels.flatMap(hotel => {
        const rooms = hotel.rooms.filter(room => (room.minNights ?? 1) <= nights);
        if (rooms.length) return [{ ...hotel, rooms }];
        const minimumStayNights = Math.min(...hotel.rooms.map(room => room.minNights ?? Infinity));
        return Number.isFinite(minimumStayNights) ? [{ ...hotel, rooms: [], minimumStayNights }] : [];
      }),
    };
  }));
}
