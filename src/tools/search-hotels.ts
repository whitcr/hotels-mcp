import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { filterAvailabilityByBudget, mapAvailability, mapHotelDetails, mergeSearchResults } from "../mappers/index.js";
import { searchHotelsInput, searchHotelsOutput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";
import { matchesProximity, mentionsRailway } from "./proximity.js";
import { validateStayDates } from "./stay-dates.js";

export function registerSearchHotels(server: McpServer, { client, maxResults, hotelPublicBaseUrl }: ToolDependencies): void {
  server.registerTool("search_hotels", {
    title: "Search available hotels",
    description: "Search current Hotels24 availability for a resolved city. REQUIRED before calling: city, check-in date, check-out date, guest count, maximum budget, budget type, and UAH currency. If any required value is missing or ambiguous, ask the customer a concise clarification question and do not call this tool. Returns absolute hotel links, factual short descriptions, matching facilities, and compact room options; never claim a preference match unless supported by returned fields.",
    inputSchema: searchHotelsInput,
    outputSchema: searchHotelsOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => runTool(async () => {
    validateStayDates(args.check_in, args.check_out);
    const excluded = new Set(args.exclude_hotel_ids);
    if (!args.proximity && mentionsRailway([args.customer_request, ...args.preferences].join(" "))) {
      throw new Error("Railway location constraint detected. Retry with proximity.type=railway and the user's radius in meters; for unspecified 'near', use 3000 and disclose it. Never return a citywide budget-only list.");
    }
    const availability = filterAvailabilityByBudget(mapAvailability(await client.getAvailability({
      cityIds: [args.city_id],
      checkIn: args.check_in,
      checkOut: args.check_out,
      guests: args.guests,
      stars: args.stars,
      hotelTypes: args.hotel_types,
      excludeHostels: args.exclude_hostels,
    }), args.guests), args.budget_max, args.budget_type).filter((hotel) => !excluded.has(hotel.hotelId));
    if (!availability.length) {
      return {
        currency: "UAH",
        check_in: args.check_in,
        check_out: args.check_out,
        customer_request: args.customer_request ?? null,
        budget: { max: args.budget_max, type: args.budget_type, currency: args.budget_currency },
        result_count: 0,
        response_guidance: ["Tell the customer that no new live availability matched the city, dates, guest count, filters, excluded hotels, and confirmed budget. Do not repeat excluded hotels. Suggest changing one constraint; do not silently ignore the budget."],
        hotels: [],
      };
    }
    // A bounded pool, filtered BEFORE the final recommendation limit.
    const candidates = availability.slice(0, args.proximity || args.exclude_hostels ? 200 : Math.min(maxResults * 2, 50));
    const hotelIds = candidates.map((hotel) => hotel.hotelId);
    const details = [];
    for (let offset = 0; offset < hotelIds.length; offset += 50) {
      details.push(...mapHotelDetails(await client.getHotelDetails(hotelIds.slice(offset, offset + 50), args.language), args.language, hotelPublicBaseUrl));
    }
    const eligible = new Set(details.filter(hotel =>
      (!args.exclude_hostels || hotel.isHostel === false) &&
      (!args.proximity || matchesProximity(hotel, args.proximity))
    ).map(hotel => hotel.id));
    const hotels = mergeSearchResults(
      candidates.filter(hotel => eligible.has(hotel.hotelId)),
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
        "All totalPrice and pricePerNight amounts already cover pricedGuests. Never multiply them again. priceBasis=bed means quantity beds in shared accommodation, NOT a private room; explicitly disclose that when recommending it. unit prices are per room/bed, not the group total.",
        ...(args.exclude_hostels ? ["Hostel properties and properties with unknown type are excluded, including private rooms in hostels. A bounded candidate pool was inspected; empty results do not prove no hotels exist in the entire city."] : []),
        ...(args.proximity ? [
          "Proximity is a hard filter, based only on returned landmarks and approximate distances in meters. No route/walking-time claims. Do not relax it.",
          "If results are empty, say no suitable hotel could be confirmed in the inspected candidates; missing distances do not mean nearby. Do not claim no hotels exist in the entire city.",
        ] : []),
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
