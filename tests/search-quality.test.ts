import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { searchHotelsInput } from "../src/schemas/hotel.schemas.js";
import { matchDescription, matchFacility } from "../src/tools/facility-match.js";
import { registerSearchHotels } from "../src/tools/search-hotels.js";

describe("facility synonyms and description evidence", () => {
  it("matches synonyms across languages and avoids false word fragments", () => {
    assert.equal(matchFacility("паркінг", ["Безкоштовна парковка"]), "Безкоштовна парковка");
    assert.equal(matchFacility("інтернет", ["Wi-Fi"]), "Wi-Fi");
    assert.equal(matchFacility("з тваринами", ["Pets allowed"]), "Pets allowed");
    assert.equal(matchFacility("спа", ["Спальня з видом"]), undefined);
    assert.equal(matchFacility("spa", ["Spa centre"]), "Spa centre");
  });
  it("finds soft evidence in the description only", () => {
    assert.equal(matchDescription("вид на море", "Номери мають чудовий вид на море."), true);
    assert.equal(matchDescription("вид на море", "Готель у лісі."), false);
    assert.equal(matchDescription("тихо", undefined), false);
  });
});

function setup(rooms: Record<number, number>, details: (id: number) => object) {
  let callback: any;
  registerSearchHotels({ registerTool: (_n: string, _c: unknown, fn: any) => callback = fn } as any, {
    maxResults: 20, hotelPublicBaseUrl: "https://hotels24.ua",
    client: {
      getAvailability: async () => ({ result: Object.entries(rooms).map(([id, price]) => ({ _id: Number(id), block: [{ block_id: Number(id), price_type: 1, block_price: price, min_price: { price, currency: "UAH" } }] })) }),
      getHotelDetails: async (ids: number[]) => ids.map(id => ({ hotel_id: id, name: "H" + id, ...details(id) })),
    },
  } as any);
  const base = { city_id: 1, check_in: "2099-01-01", check_out: "2099-01-02", guests: 2, budget_max: 5000, budget_type: "total", budget_currency: "UAH" };
  return (extra: object = {}) => callback(z.object(searchHotelsInput).parse({ ...base, ...extra }));
}

describe("search quality", () => {
  it("ranks richer hotels first among equal matches", async () => {
    const search = setup({ 1: 500, 2: 900 }, id => id === 2 ? { class: 5, descriptions: { description: { text: "Гарний готель" } }, photos: [{ url: "https://x/y.jpg" }] } : {});
    const result = await search();
    assert.deepEqual(result.structuredContent.hotels.map((h: any) => h.id), [2, 1]);
  });

  it("uses the description as soft evidence and reports it separately", async () => {
    const search = setup({ 1: 500 }, () => ({ descriptions: { description: { text: "Номери мають вид на море." } } }));
    const [hotel] = (await search({ preferences: ["вид на море"] })).structuredContent.hotels;
    assert.deepEqual(hotel.descriptionMatches, ["вид на море"]);
    assert.deepEqual(hotel.matchReasons, []);
    assert.deepEqual(hotel.missingPreferences, []);
  });

  it("without a budget returns economy, mid and comfort options", async () => {
    const search = setup({ 1: 400, 2: 700, 3: 1500, 4: 2500, 5: 4000, 6: 9000 }, () => ({}));
    const result = await search({ budget_max: undefined });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent.hotels.map((h: any) => h.priceTier), ["economy", "mid", "comfort"]);
    const prices = result.structuredContent.hotels.map((h: any) => h.totalPrice);
    assert(prices[0] < prices[1] && prices[1] < prices[2]);
  });

  it("suggests the budget that would give a result", async () => {
    const search = setup({ 1: 2500, 2: 3200 }, () => ({}));
    const result = await search({ budget_max: 1000 });
    assert.equal(result.structuredContent.result_count, 0);
    assert.deepEqual(result.structuredContent.suggestions, [{ kind: "increase_budget", budget_needed: 2500, budget_type: "total" }]);
  });

  it("suggests the radius that would give a result", async () => {
    const search = setup({ 1: 500 }, () => ({ tags: { geo: [{ name: "railway", distance: 4200 }] } }));
    const result = await search({ proximity: { type: "railway", max_distance_m: 3000 } });
    assert.equal(result.structuredContent.result_count, 0);
    assert.deepEqual(result.structuredContent.suggestions, [{ kind: "widen_radius", distance_m: 4200 }]);
  });
});
