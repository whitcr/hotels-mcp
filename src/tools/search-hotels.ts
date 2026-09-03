import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { filterAvailabilityByBudget, mapAvailability, mapHotelDetails, mergeSearchResults } from "../mappers/index.js";
import { searchHotelsInput, searchHotelsOutput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";

export function registerSearchHotels(server: McpServer, { client, maxResults, hotelPublicBaseUrl }: ToolDependencies): void {
  server.registerTool("search_hotels", {
    title: "Search available hotels",
    description: "Search current Hotels24 availability for a resolved city. REQUIRED before calling: city, check-in date, check-out date, guest count, maximum budget, budget type, and UAH currency. If any required value is missing or ambiguous, ask the customer a concise clarification question and do not call this tool. Returns absolute hotel links, factual short descriptions, matching facilities, and compact room options; never claim a preference match unless supported by returned fields.",
    inputSchema: searchHotelsInput,
    outputSchema: searchHotelsOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => runTool(async () => {
    if (args.check_in >= args.check_out) throw new Error("check_out must be after check_in");
    const today = new Date().toISOString().slice(0, 10);
    if (args.check_in < today) throw new Error(`check_in must not be in the past; today is ${today}`);
    const availability = filterAvailabilityByBudget(mapAvailability(await client.getAvailability({
      cityIds: [args.city_id],
      checkIn: args.check_in,
      checkOut: args.check_out,
      guests: args.guests,
      stars: args.stars,
      hotelTypes: args.hotel_types,
      excludeHostels: args.exclude_hostels,
    })), args.budget_max, args.budget_type).slice(0, Math.min(maxResults * 2, 50));
    if (!availability.length) {
      return {
        currency: "UAH",
        check_in: args.check_in,
        check_out: args.check_out,
        customer_request: args.customer_request ?? null,
        budget: { max: args.budget_max, type: args.budget_type, currency: args.budget_currency },
        result_count: 0,
        response_guidance: ["Tell the customer that no live availability matched the city, dates, guest count, filters, and confirmed budget. Suggest changing one constraint; do not silently ignore the budget."],
        hotels: [],
      };
    }
    const hotelIds = availability.map((hotel) => hotel.hotelId);
    const details = mapHotelDetails(
      await client.getHotelDetails(hotelIds, args.language),
      args.language,
      hotelPublicBaseUrl,
    );
    const hotels = mergeSearchResults(
      availability,
      details,
      args.check_in,
      args.check_out,
      Math.min(args.limit, maxResults),
      args.customer_request,
      args.preferences,
      args.budget_max,
      args.budget_type,
    );
    return {
      currency: "UAH",
      check_in: args.check_in,
      check_out: args.check_out,
      customer_request: args.customer_request ?? null,
      budget: { max: args.budget_max, type: args.budget_type, currency: args.budget_currency },
      result_count: hotels.length,
      response_guidance: [
        "Answer in the user's language.",
        "For each recommended hotel, include its name as a Markdown link using url.",
        "Write one or two concise factual sentences using only shortDescription, matchReasons, facilities, rating, location, and live price fields.",
        "Explain why it fits the request only when the returned data supports that claim.",
        "State that prices and availability may change and should be rechecked before booking.",
      ],
      hotels,
    };
  }));
}
