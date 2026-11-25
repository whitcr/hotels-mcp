import assert from "node:assert/strict";
import { it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { HotelsApiClient } from "../src/clients/hotels-api.client.js";
import { uiEventSchema } from "../src/logging/events.js";

const url = "https://hotels24.ua/uk/Hotel-14807.html";
const searchOutput = { result_count: 1, hotels: [{ id: 14807, name: "Hotel", url, photos: ["https://img.hotels24.ua/a.jpg", "javascript:alert(1)"], stars: 4, totalPrice: 1800, pricePerNight: 900, currency: "UAH", locationMatch: { distanceMeters: 800 } }] };
const call = (id: string, name: string, args: unknown) => ({ id, output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }] });

function chatWith(responses: unknown[]) {
  const chat = new HotelChat("k", "m", async () => searchOutput);
  (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async () => responses.shift() } };
  return chat;
}

it("returns cards only for hotels linked in the answer, with safe photo urls and dated links", async () => {
  const dates = { check_in: "2026-12-09", check_out: "2026-12-10", guests: 2 };
  const result = await chatWith([call("t", "search_hotels", dates), { id: "r", output: [], output_text: `Try [Hotel](${url}).` }]).respond("Find hotels in Lviv");
  assert.equal(result.hotel_cards.length, 1);
  assert.equal(result.hotel_cards[0]!.photo, "https://img.hotels24.ua/a.jpg");
  assert.match(result.hotel_cards[0]!.url, /dateArrival=09.12.2026/);
  assert.equal(result.handoff, null);
  const kinds = result.analytics.map(item => item.kind);
  assert.deepEqual(kinds, ["search_result", "hotels_shown"]);
  assert.equal(result.analytics[0]!.detail.result_count, 1);
  assert(!JSON.stringify(result.analytics).includes("Lviv"));
});

it("offers a human handoff for large groups and no cards for unlinked answers", async () => {
  const dates = { check_in: "2026-12-09", check_out: "2026-12-10", guests: 12 };
  const result = await chatWith([call("t", "search_hotels", dates), { id: "r", output: [], output_text: "Please use the group form." }]).respond("Find hotels for 12");
  assert.equal(result.handoff?.form_url, "https://hotels24.ua/uk/groups/");
  assert.equal(result.handoff?.phone, "+380 98 039 33 49");
  assert.deepEqual(result.hotel_cards, []);
});

it("validates UI funnel events and rejects free text", () => {
  assert(uiEventSchema.safeParse({ chat_id: "a".repeat(24), type: "hotel_click", hotel_id: 5 }).success);
  assert(!uiEventSchema.safeParse({ chat_id: "a".repeat(24), type: "other" }).success);
});

it("caches repeated lookups briefly, never caches failures, and re-checks availability live", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return calls === 1 ? new Response("{}", { status: 400 }) : new Response('{"result":[]}'); }) as typeof fetch;
  try {
    const client = new HotelsApiClient("http://api/v1", undefined, 1000, undefined, 0, true);
    await assert.rejects(client.getHotelDetails([1], "uk"));
    await client.getHotelDetails([1], "uk");
    await client.getHotelDetails([1], "uk");
    assert.equal(calls, 2);
    const params = { cityIds: [1], checkIn: "2099-01-01", checkOut: "2099-01-02", guests: 2 };
    await client.getAvailability(params); await client.getAvailability(params);
    assert.equal(calls, 3);
    await client.getAvailability({ ...params, fresh: true });
    assert.equal(calls, 4);
    const uncached = new HotelsApiClient("http://api/v1", undefined, 1000, undefined, 0);
    await uncached.getHotelDetails([1], "uk"); await uncached.getHotelDetails([1], "uk");
    assert.equal(calls, 6);
  } finally { globalThis.fetch = realFetch; }
});
