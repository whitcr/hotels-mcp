import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { filterAvailabilityByBudget, mapAvailability, mapHotelDetails, mergeSearchResults } from "../mappers/index.js";
import { searchHotelsInput, searchHotelsOutput } from "../schemas/hotel.schemas.js";
import { runTool } from "./tool.helpers.js";
import type { ToolDependencies } from "./tool.types.js";
import { findProximity, mentionsRailway } from "./proximity.js";
import { validateStayDates } from "./stay-dates.js";
import type { HotelAvailability } from "../types.js";

export function registerSearchHotels(server: McpServer, { client, maxResults, hotelPublicBaseUrl }: ToolDependencies): void {
  server.registerTool("search_hotels", {
    title: "Search available hotels",
    description: "Search current Hotels24 availability for a resolved city. REQUIRED before calling: city, check-in date, check-out date, guest count, maximum budget, budget type, and UAH currency. If any required value is missing or ambiguous, ask the customer a concise clarification question and do not call this tool. Returns absolute hotel links, factual short descriptions, matching facilities, and compact room options; never claim a preference match unless supported by returned fields.",
    inputSchema: searchHotelsInput,
    outputSchema: searchHotelsOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => runTool(async () => {
    validateStayDates(args.check_in, args.check_out);
    if ((args.budget_min ?? 0) > args.budget_max) throw new Error("Budget minimum exceeds maximum");
    const nights = (Date.parse(args.check_out) - Date.parse(args.check_in)) / 86_400_000;
    const group = args.guests >= 6;
    const poolPattern = /басейн|бассейн|\bpool\b/iu;
    const poolRequested = poolPattern.test([args.customer_request, ...args.preferences].join(" "));
    if (poolRequested && !args.pool_type) throw new Error("Clarify whether an indoor or outdoor swimming pool is wanted, or either is suitable.");
    if (args.proximity?.type === "map_point" && !args.proximity.point) throw new Error("Map point coordinates are required");
    if (args.proximity?.type === "landmark" && !args.proximity.name) throw new Error("A named landmark is required");
    const excluded = new Set(args.exclude_hotel_ids);
    if (!args.proximity && mentionsRailway([args.customer_request, ...args.preferences].join(" "))) {
      throw new Error("Railway location constraint detected. Retry with proximity.type=railway and the user's radius in meters; for unspecified 'near', use 3000 and disclose it. Never return a citywide budget-only list.");
    }
    const availability = filterAvailabilityByBudget(mapAvailability(await client.getAvailability({
      cityIds: [args.city_id],
      checkIn: args.check_in,
      checkOut: args.check_out,
      guests: group ? 1 : args.guests,
      stars: args.stars,
      hotelTypes: args.hotel_types,
      excludeHostels: args.exclude_hostels,
    }), args.guests, group), args.budget_max, args.budget_type, args.budget_min).filter((hotel) => !excluded.has(hotel.hotelId));
    if (!availability.length) {
      return {
        currency: "UAH",
        check_in: args.check_in,
        check_out: args.check_out,
        customer_request: args.customer_request ?? null,
        budget: { min: args.budget_min, max: args.budget_max, type: args.budget_type, currency: args.budget_currency },
        result_count: 0,
        response_guidance: ["Tell the customer that no new live availability matched the city, dates, guest count, filters, excluded hotels, and confirmed budget. Do not repeat excluded hotels. Suggest changing one constraint; do not silently ignore the budget."],
        hotels: [],
      };
    }
    // A bounded pool, filtered BEFORE the final recommendation limit.
    const bookable = availability.filter(hotel => hotel.rooms.some(room => (room.minNights ?? 1) <= nights));
    const bookableIds = new Set(bookable.map(hotel => hotel.hotelId));
    const inspectMore = group || args.proximity || args.exclude_hostels || args.preferences.length || args.pool_type;
    // The upstream order is arbitrary: rank by price first so the bounded pool is
    // deterministic and never drops the cheapest matches. Hotels with location or
    // service filters need many more inspected candidates, since most are discarded.
    const cheapest = (hotel: HotelAvailability) => Math.min(...hotel.rooms.map(room =>
      (args.budget_type === "per_night" ? room.pricePerNight : room.totalPrice) ?? Infinity));
    const byPrice = (a: HotelAvailability, b: HotelAvailability) => cheapest(a) - cheapest(b);
    const candidates = [...bookable.sort(byPrice), ...availability.filter(hotel => !bookableIds.has(hotel.hotelId)).sort(byPrice)]
      .slice(0, inspectMore ? 400 : Math.min(maxResults * 2, 50));
    const hotelIds = candidates.map((hotel) => hotel.hotelId);
    const batches: number[][] = [];
    for (let offset = 0; offset < hotelIds.length; offset += 50) batches.push(hotelIds.slice(offset, offset + 50));
    const details = (await Promise.all(batches.map(async batch =>
      mapHotelDetails(await client.getHotelDetails(batch, args.language), args.language, hotelPublicBaseUrl)))).flat();
    const eligible = details.filter(hotel => {
      if (args.exclude_hostels && hotel.isHostel !== false) return false;
      if (args.pool_type && !hotel.poolTypes?.some(type => args.pool_type === "either" || type === args.pool_type)) return false;
      if (args.proximity) {
        const locationMatch = findProximity(hotel, args.proximity);
        if (!locationMatch) return false;
        hotel.locationMatch = { name: locationMatch.name, distanceMeters: locationMatch.distanceMeters };
      }
      return true;
    });
    const eligibleIds = new Set(eligible.map(hotel => hotel.id));
    const relevant = candidates.filter(hotel => eligibleIds.has(hotel.hotelId));
    const preferences = args.preferences.filter(preference => !(args.pool_type && poolPattern.test(preference)));
    const limit = Math.min(args.limit, maxResults);
    const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const matching = (shortStay: boolean) => {
      const entries = relevant.flatMap(hotel => {
        const rooms = hotel.rooms.filter(room => ((room.minNights ?? 1) > nights) === shortStay);
        return rooms.length ? [{ ...hotel, rooms }] : [];
      });
      const results = mergeSearchResults(entries, eligible, args.check_in, args.check_out, entries.length);
      return results.map(result => {
        const facts = [...result.facilities, ...result.rooms.flatMap(room => room.facilities)];
        const matched = preferences.map(preference => {
          const query = normalize(preference);
          return query.length >= 2 ? facts.find(fact => normalize(fact).includes(query)) : undefined;
        });
        return {
          ...result,
          matchReasons: [...new Set(matched.filter((fact): fact is string => Boolean(fact)))],
          matchScore: matched.filter(Boolean).length + (args.pool_type ? 1 : 0),
          missingPreferences: preferences.filter((_, index) => !matched[index]),
        };
      }).filter(hotel => !preferences.length || hotel.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore);
    };
    let hotels = matching(false);
    if (!hotels.length) {
      const minimums = new Map(relevant.map(hotel => [
        hotel.hotelId,
        Math.min(...hotel.rooms.filter(room => (room.minNights ?? 1) > nights).map(room => room.minNights!)),
      ]));
      hotels = matching(true).map(hotel => ({
        ...hotel,
        minimumStayNights: minimums.get(hotel.id),
        totalPrice: undefined,
        pricePerNight: undefined,
        pricedGuests: undefined,
        quantity: undefined,
        priceBasis: undefined,
        availableRooms: 0,
        rooms: [],
      }));
    }
    // Show different verified property types for groups of the same match quality.
    const ranked = hotels;
    hotels = [];
    const shown = new Set<number>();
    for (const score of new Set(ranked.map(hotel => hotel.matchScore))) {
      const tier = ranked.filter(hotel => hotel.matchScore === score);
      if (group) {
        const types = new Set<number | string>();
        for (const hotel of tier) {
          const type = hotel.hotelTypeId ?? hotel.propertyType;
          if (type === undefined || types.has(type)) continue;
          types.add(type);
          shown.add(hotel.id);
          hotels.push(hotel);
        }
      }
      hotels.push(...tier.filter(hotel => !shown.has(hotel.id)));
    }
    // If a full match exists, keep partial matches out of the recommendation list.
    if (hotels.some(hotel => hotel.missingPreferences?.length === 0)) {
      hotels = hotels.filter(hotel => hotel.missingPreferences?.length === 0);
    }
    hotels = hotels.slice(0, limit);
    return {
      currency: "UAH",
      check_in: args.check_in,
      check_out: args.check_out,
      customer_request: args.customer_request ?? null,
      budget: { min: args.budget_min, max: args.budget_max, type: args.budget_type, currency: args.budget_currency },
      result_count: hotels.length,
      response_guidance: [
        "All totalPrice and pricePerNight amounts already cover pricedGuests. Never multiply them again. priceBasis=bed means quantity beds in shared accommodation, NOT a private room; explicitly disclose that when recommending it. unit prices are per room/bed, not the group total.",
        ...(args.exclude_hostels ? ["Hostel properties and properties with unknown type are excluded, including private rooms in hostels. A bounded candidate pool was inspected; empty results do not prove no hotels exist in the entire city."] : []),
        ...(args.proximity ? [
          "Proximity is a hard filter, based only on returned landmarks and approximate distances in meters. No route/walking-time claims. Do not relax it.",
          "If results are empty, say no suitable hotel could be confirmed in the inspected candidates; missing distances do not mean nearby. Do not claim no hotels exist in the entire city.",
        ] : []),
        "Answer in the user's language.",
        "If missingPreferences is nonempty, explicitly explain which requested services could be confirmed and which could not. If hotels is empty, do not offer unrelated options.",
        "If minimumStayNights is present, this is an alternative only if the customer can extend the stay. Explain the minimum nights. Availability and price for the extended period are not confirmed.",
        "When priceBasis is room and quantity is above one, describe the number and type of rooms. The returned group total already includes all of them.",
        "Use locationMatch for a confirmed landmark and straight-line distance. Use the hotel description for qualitative details and never infer a route or an unverified distance.",
        "For each recommended hotel, include its name as a Markdown link using url.",
        "Write one or two concise factual sentences using only shortDescription, matchReasons, facilities, rating, location, and live price fields.",
        "Explain why it fits the request only when the returned data supports that claim.",
        "State that prices and availability may change and should be rechecked before booking.",
      ],
      hotels,
    };
  }));
}
