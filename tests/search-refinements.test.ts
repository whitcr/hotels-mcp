import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";
import { registerSearchHotels } from "../src/tools/search-hotels.js";
import { searchHotelsInput, searchHotelsOutput } from "../src/schemas/hotel.schemas.js";
import { normalizeHotelLinks } from "../src/chat/verified-links.js";

const defaults = {
  city_id: 1, check_in: "2099-01-01", check_out: "2099-01-02",
  guests: 2, budget_max: 10000, budget_type: "total", budget_currency: "UAH",
};

function fixture(id: number, price: number, options: {
  nights?: number; capacity?: number; inventory?: number; type?: number;
  facilities?: Array<{id: number; name: string}>;
} = {}) {
  return {
    availability: {hotel_id: id, block: [{
      block_id: id, price_type: 1, block_price: price,
      min_price: {price, currency: "UAH"}, minNights: options.nights ?? 1,
      max_occupancy: options.capacity ?? 2,
      incremental_price: Array.from({length: options.inventory ?? 1}, () => ({price, currency: "UAH"})),
    }]},
    details: {hotel_id: id, hoteltype_id: options.type ?? 1, name: "Hotel " + id, facilities: options.facilities ?? []},
  };
}

function setup(fixtures: ReturnType<typeof fixture>[]) {
  let handler!: (args: unknown) => Promise<any>;
  const guestQueries: number[] = [];
  registerSearchHotels({registerTool: (_name: string, _config: unknown, callback: typeof handler) => { handler = callback; }} as any, {
    maxResults: 10, hotelPublicBaseUrl: "https://hotels24.ua",
    client: {
      getAvailability: async ({guests}: {guests: number}) => {
        guestQueries.push(guests);
        return fixtures.map(item => item.availability);
      },
      getHotelDetails: async (ids: number[]) => fixtures.filter(item => ids.includes(item.details.hotel_id)).map(item => item.details),
    },
  } as any);
  const request = (overrides: Record<string, unknown> = {}) => handler(z.object(searchHotelsInput).parse({...defaults, ...overrides}));
  return {
    guestQueries, request,
    async hotels(overrides: Record<string, unknown> = {}) {
      const result = await request(overrides);
      assert.equal(result.isError, undefined, result.content?.[0]?.text);
      return z.object(searchHotelsOutput).parse(result.structuredContent).hotels;
    },
  };
}

it("uses both budget bounds and offers partial matches only if no full service match exists", async () => {
  const parking = {id: 1, name: "Паркування"};
  const breakfast = {id: 2, name: "Сніданок"};
  const search = setup([
    fixture(1, 500, {facilities: [parking, breakfast]}),
    fixture(2, 1200, {facilities: [parking]}),
    fixture(3, 1300),
    fixture(4, 2500, {facilities: [parking, breakfast]}),
    fixture(5, 3100, {facilities: [parking, breakfast]}),
  ]);
  const preferences = ["Паркування", "Сніданок"];
  const partial = await search.hotels({preferences, budget_min: 1000, budget_max: 2000});
  assert.deepEqual(partial.map(h => h.id), [2]);
  assert.deepEqual(partial[0]!.matchReasons, ["Паркування"]);
  assert.deepEqual(partial[0]!.missingPreferences, ["Сніданок"]);
  assert.deepEqual((await search.hotels({preferences, budget_min: 1000, budget_max: 3000})).map(h => h.id), [4]);
});

it("excludes minimum stay offers when a valid choice exists and labels fallback without a price", async () => {
  const search = setup([fixture(1, 1000, {nights: 3}), fixture(2, 1800)]);
  assert.deepEqual((await search.hotels()).map(h => h.id), [2]);
  const alternatives = await search.hotels({exclude_hotel_ids: [2]});
  assert.equal(alternatives[0]!.minimumStayNights, 3);
  assert.equal(alternatives[0]!.totalPrice, undefined);
  assert.deepEqual(alternatives[0]!.rooms, []);
});

it("requires a pool choice and never treats a sauna pool as a swimming pool", async () => {
  const search = setup([
    fixture(1, 1000, {facilities: [{id: 47, name: "Басейн для сауни"}]}),
    fixture(2, 1200, {facilities: [{id: 45, name: "Відкритий басейн"}]}),
    fixture(3, 1300, {facilities: [{id: 46, name: "Критий басейн"}]}),
  ]);
  assert.equal((await search.request({customer_request: "Готель з басейном"})).isError, true);
  assert.deepEqual((await search.hotels({pool_type: "indoor"})).map(h => h.id), [3]);
  assert.deepEqual((await search.hotels({pool_type: "either"})).map(h => h.id), [2, 3]);
});

it("searches across room sizes and shows distinct property types with enough inventory for the whole group", async () => {
  const search = setup([
    fixture(1, 100, {capacity: 2, inventory: 15}),
    fixture(2, 120, {capacity: 2, inventory: 16}),
    fixture(3, 300, {capacity: 4, inventory: 8, type: 2}),
    fixture(4, 25, {capacity: 2, inventory: 5, type: 3}),
  ]);
  const hotels = await search.hotels({guests: 32, limit: 2});
  assert.deepEqual(search.guestQueries, [1]);
  assert.deepEqual(hotels.map(h => [h.id, h.quantity, h.totalPrice]), [[2, 16, 1920], [3, 8, 2400]]);
});

it("allows the official group form and leaves it free of hotel stay parameters", () => {
  const text = "[Форма для груп](https://hotels24.ua/uk/groups/)";
  assert.deepEqual(normalizeHotelLinks(text, new Map(), {check_in: "2099-01-01", check_out: "2099-01-02"}), {text, unverified: false});
});
