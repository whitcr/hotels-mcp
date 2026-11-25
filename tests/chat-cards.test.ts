import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { splitRecommended } from "../src/chat/recommended.js";
import { DeltaFilter } from "../src/chat/stream-filter.js";
import { collectHotelCards, decorateCards, type HotelCard } from "../src/chat/verified-links.js";
import { mapHotelDetails } from "../src/mappers/hotel.mapper.js";
import { absolutePhotoUrl } from "../src/mappers/mapper.helpers.js";

describe("hotel photos", () => {
  it("builds absolute image-host URLs from the relative API paths, using the card size", () => {
    assert.equal(absolutePhotoUrl("partner_hotel/facility/135/13515/1351543/Otel-foto-1351543.jpg"),
      "https://img.hotels24.ua/photos/partner_hotel/facility/135/13515/1351543/Otel-foto-1351543mx.jpg");
    assert.equal(absolutePhotoUrl("//img.hotels24.ua/photos/partner_hotel/a/b-1z600.jpg"), "https://img.hotels24.ua/photos/partner_hotel/a/b-1mx.jpg");
    assert.equal(absolutePhotoUrl("http://cdn.example.com/x.jpg"), "https://cdn.example.com/x.jpg");
    assert.equal(absolutePhotoUrl("javascript:alert(1)"), undefined);
    assert.equal(absolutePhotoUrl(""), undefined);
  });
  it("uses the photo for hotel details and removes duplicates", () => {
    const [hotel] = mapHotelDetails([{ hotel_id: 1, name: "H", hotel_photo: "partner_hotel/a/b-foto-1.jpg", our_url_original: "partner_hotel/a/b-foto-1.jpg" }], "uk", "https://hotels24.ua");
    assert.deepEqual(hotel!.photos, ["https://img.hotels24.ua/photos/partner_hotel/a/b-foto-1mx.jpg"]);
  });
});

describe("recommended line", () => {
  it("extracts valid ids, drops garbage and never leaves the line in the text", () => {
    assert.deepEqual(splitRecommended("Short text.\nRECOMMENDED: [14807, 15599, 14807, -1, \"x\", 2.5]"), { text: "Short text.", items: [{ id: 14807 }, { id: 15599 }] });
    assert.deepEqual(splitRecommended("Text\nRECOMMENDED: [oops"), { text: "Text", items: [] });
    assert.deepEqual(splitRecommended("No line here."), { text: "No line here.", items: [] });
  });
  it("keeps one clean sentence per hotel and drops unsafe ones", () => {
    const result = splitRecommended('Intro.\nRECOMMENDED: [{"id":1,"summary":"  In the   center;\\nwine bar. "},{"id":2,"summary":"See https://evil.example"},{"id":3,"summary":"<b>x</b>"},{"id":4,"summary":"' + "x".repeat(300) + '"}]');
    assert.equal(result.text, "Intro.");
    assert.deepEqual(result.items.slice(0, 3), [{ id: 1, summary: "In the center; wine bar." }, { id: 2 }, { id: 3 }]);
    assert.equal(result.items[3]!.summary!.length, 220);
  });
  it("is hidden from streamed text as well", () => {
    const filter = new DeltaFilter();
    const out = ["Hi there.\nRECOM", 'MENDED: [1,2]\nQUICK_REPLIES: ["A"]'].map(chunk => filter.push(chunk)).join("") + filter.flush();
    assert.equal(out, "Hi there.");
  });
});

describe("card labels", () => {
  const card = (id: number, extra: Partial<HotelCard>): HotelCard => ({ id, name: "H" + id, url: "https://hotels24.ua/h" + id, ...extra });
  it("marks the single cheapest and nearest hotel, plus the price tier", () => {
    const result = decorateCards([card(1, { price_per_night: 900, distance_m: 800, price_tier: "economy" }), card(2, { price_per_night: 1500, distance_m: 300 }), card(3, { price_per_night: 2500, distance_m: 2000, price_tier: "comfort" })]);
    assert.deepEqual(result.map(item => item.badges), [["economy", "best_price"], ["nearest"], ["comfort"]]);
  });
  it("gives no price or distance label on a tie or for a single hotel", () => {
    assert.deepEqual(decorateCards([card(1, { price_per_night: 900 }), card(2, { price_per_night: 900 })]).map(item => item.badges), [undefined, undefined]);
    assert.equal(decorateCards([card(1, { price_per_night: 900, distance_m: 5 })])[0]!.badges, undefined);
  });
  it("collects notes about missing services and minimum stay from tool data only", () => {
    const cards = new Map<number, HotelCard>();
    collectHotelCards({ hotels: [{ id: 7, name: "H", url: "https://hotels24.ua/h", missingPreferences: ["sauna", "x".repeat(80)], minimumStayNights: 3, priceTier: "mid", locationMatch: { distanceMeters: 500, type: "railway" } }] }, cards);
    assert.deepEqual(cards.get(7)!.missing, ["sauna"]);
    assert.equal(cards.get(7)!.min_stay_nights, 3);
    assert.equal(cards.get(7)!.price_tier, "mid");
    assert.equal(cards.get(7)!.distance_type, "railway");
  });
});

describe("cards mode", () => {
  const url = "https://hotels24.ua/uk/Hotel-5.html";
  const search = { result_count: 2, hotels: [
    { id: 5, name: "Alpha", url, photos: ["https://img.hotels24.ua/photos/a-mx.jpg"], totalPrice: 1000, pricePerNight: 1000, currency: "UAH" },
    { id: 6, name: "Beta", url: "https://hotels24.ua/uk/Hotel-6.html", totalPrice: 2000, pricePerNight: 2000, currency: "UAH" },
  ] };
  const call = { id: "t", output: [{ type: "function_call", name: "search_hotels", arguments: JSON.stringify({ check_in: "2026-12-09", check_out: "2026-12-10", guests: 2 }), call_id: "c" }] };
  const make = (answers: string[], requests: any[] = []) => {
    const chat = new HotelChat("k", "m", async () => search);
    const queue = [call, ...answers.map((text, index) => ({ id: "r" + index, output: [], output_text: text }))];
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => { requests.push(request); return queue.shift(); } } };
    return chat;
  };

  it("sends the cards rules only when the widget supports cards", async () => {
    const requests: any[] = [];
    await make(["Here you go.\nRECOMMENDED: [5]"], requests).respond("Find hotels in Lviv", undefined, "en", undefined, { cards: true });
    assert.match(requests[0].instructions, /CARDS MODE/);
    const plain: any[] = [];
    await make(["Here you go."], plain).respond("Find hotels in Lviv", undefined, "en");
    assert.doesNotMatch(plain[0].instructions, /CARDS MODE/);
  });

  it("shows exactly the recommended hotels as cards without links in the text", async () => {
    const result = await make(['Two options in Lviv.\nRECOMMENDED: [6,5,999]\nQUICK_REPLIES: ["More"]']).respond("Find hotels in Lviv", undefined, "en", undefined, { cards: true });
    assert.equal(result.message, "Two options in Lviv.");
    assert.deepEqual(result.hotel_cards.map(card => card.id), [6, 5]);
    assert.match(result.hotel_cards[1]!.url, /dateArrival=09.12.2026/);
    assert(!result.message.includes("RECOMMENDED"));
    assert.deepEqual(result.hotel_cards[0]!.badges, undefined);
    assert.equal(result.hotel_cards[1]!.photo, "https://img.hotels24.ua/photos/a-mx.jpg");
  });

  it("asks the model to add the hidden line when hotels were found but none was chosen", async () => {
    const requests: any[] = [];
    const result = await make(["Two options in Lviv.", "Two options in Lviv.\nRECOMMENDED: [5]"], requests).respond("Find hotels in Lviv", undefined, "en", undefined, { cards: true });
    assert.deepEqual(result.hotel_cards.map(card => card.id), [5]);
    assert.match(requests.at(-1).input[0].content, /RECOMMENDED/);
  });
});
