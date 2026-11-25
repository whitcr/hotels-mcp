import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";
import { answerIssues } from "../src/chat/language.js";
import { mapHotelDetails } from "../src/mappers/hotel.mapper.js";
import { searchHotelsInput } from "../src/schemas/hotel.schemas.js";
import { findProximity } from "../src/tools/proximity.js";
import { registerSearchHotels } from "../src/tools/search-hotels.js";
import { todayInKyiv } from "../src/today.js";
import { mapDestinations } from "../src/mappers/hotel.mapper.js";

it("reports the nearest matching landmark, not the first in API order", () => {
  const [hotel] = mapHotelDetails([{ hotel_id: 1, tags: { geo: [
    { name: "railway", distance: 2900, valueLang: { uk: "Далекий" } },
    { name: "railway", distance: 400, valueLang: { uk: "Близький" } },
  ] } }], "uk", "https://hotels24.ua");
  assert.equal(findProximity(hotel!, { type: "railway", max_distance_m: 3000 })?.distanceMeters, 400);
});

it("keeps cities ahead of hotels so truncation cannot drop the city", () => {
  const hotels = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, name: "Kyiv Hotel " + i }));
  const result = mapDestinations({ hotels, cities: [{ id: 1, name: "Київ" }] }, "uk").slice(0, 20);
  assert(result.some(item => item.type === "city" && item.id === 1));
});

it("computes today in the Kyiv time zone", () => {
  assert.equal(todayInKyiv(new Date("2026-06-10T22:30:00Z")), "2026-06-11");
  assert.equal(todayInKyiv(new Date("2026-12-10T21:30:00Z")), "2026-12-10");
  assert.equal(todayInKyiv(new Date("2026-12-10T22:30:00Z")), "2026-12-11");
});

it("allows ordinary English words but still rejects internal fields", () => {
  assert.deepEqual(answerIssues("Its proximity to the center is great, total price 3000 UAH.", "en"), []);
  assert(answerIssues("Set budget_type to total.", "en").length);
  assert(answerIssues("Помилка з API.", "uk").length);
});

it("inspects the cheapest hotels first instead of an arbitrary upstream slice", async () => {
  let callback: any;
  const inspected: number[] = [];
  registerSearchHotels({ registerTool: (_n: string, _c: unknown, fn: any) => callback = fn } as any, {
    maxResults: 1, hotelPublicBaseUrl: "https://hotels24.ua",
    client: {
      // Upstream order: expensive first; with maxResults=1 only 2 candidates are inspected.
      getAvailability: async () => ({ result: [5, 4, 3, 2, 1].map(id => ({ _id: id, block: [{ block_id: id, price_type: 1, block_price: id * 100, min_price: { price: id * 100, currency: "UAH" } }] })) }),
      getHotelDetails: async (ids: number[]) => { inspected.push(...ids); return ids.map(id => ({ hotel_id: id, name: "H" + id })); },
    },
  } as any);
  const args = z.object(searchHotelsInput).parse({ city_id: 1, check_in: "2099-01-01", check_out: "2099-01-02", guests: 2, budget_max: 3000, budget_type: "total", budget_currency: "UAH" });
  const result = await callback(args);
  assert.deepEqual(inspected.sort(), [1, 2]);
  assert.equal(result.structuredContent.hotels[0].id, 1);
});
