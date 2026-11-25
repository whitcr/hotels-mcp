import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";

describe("card summaries and a text without a hotel list", () => {
  const search = {
    result_count: 2,
    response_guidance: [
      "For each recommended hotel, include its name as a Markdown link using url.",
      "Write one or two concise factual sentences using only shortDescription, matchReasons, facilities, rating, location, and live price fields.",
      "State that prices and availability may change and should be rechecked before booking.",
    ],
    hotels: [
      { id: 5, name: "Wine&Pillow Hotel", url: "https://hotels24.ua/uk/Hotel-5.html", totalPrice: 3000, pricePerNight: 1500, currency: "UAH" },
      { id: 6, name: "Galian", url: "https://hotels24.ua/uk/Hotel-6.html", totalPrice: 3000, pricePerNight: 1500, currency: "UAH" },
    ],
  };
  const call = { id: "t", output: [{ type: "function_call", name: "search_hotels", arguments: JSON.stringify({ check_in: "2026-12-09", check_out: "2026-12-11", guests: 2 }), call_id: "c" }] };
  const make = (answers: string[], requests: any[]) => {
    const chat = new HotelChat("k", "m", async () => search);
    const queue = [call, ...answers.map((text, index) => ({ id: "r" + index, output: [], output_text: text }))];
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => { requests.push(request); return queue.shift(); } } };
    return chat;
  };
  const good = 'Two options in Odesa for 2 guests, 09.12.2026 — 11.12.2026. Prices may change; please recheck.\nRECOMMENDED: [{"id":5,"summary":"In the very center; has a wine lobby bar."},{"id":6,"summary":"Guest house with a sauna and a hammam."}]';

  it("puts each hotel's description into its card and keeps the text short", async () => {
    const requests: any[] = [];
    const result = await make([good], requests).respond("Find hotels in Odesa", undefined, "en", undefined, { cards: true });
    assert.deepEqual(result.hotel_cards.map(card => card.summary), ["In the very center; has a wine lobby bar.", "Guest house with a sauna and a hammam."]);
    assert(!result.message.includes("Wine&Pillow"));
  });

  it("does not hand the model the tool's per-hotel link instruction in cards mode", async () => {
    const requests: any[] = [];
    await make([good], requests).respond("Find hotels in Odesa", undefined, "en", undefined, { cards: true });
    const toolOutput = requests[1].input[0].output as string;
    assert(!toolOutput.includes("include its name as a Markdown link"));
    assert.match(toolOutput, /shown to the customer as a card/);
    const plain: any[] = [];
    await make(["Here are two hotels [Wine&Pillow Hotel](https://hotels24.ua/uk/Hotel-5.html)."], plain).respond("Find hotels in Odesa", undefined, "en");
    assert((plain[1].input[0].output as string).includes("include its name as a Markdown link"));
  });

  it("asks for a rewrite when the text still lists the hotels", async () => {
    const requests: any[] = [];
    const list = '- Wine&Pillow Hotel. In the center. 1500 UAH/night.\n- Galian. Guest house with a sauna. 1500 UAH/night.\nRECOMMENDED: [{"id":5,"summary":"x"},{"id":6,"summary":"y"}]';
    const result = await make([list, good], requests).respond("Find hotels in Odesa", undefined, "en", undefined, { cards: true });
    assert.match(requests.at(-1).input[0].content, /remove the list of hotels from the text/i);
    assert(!result.message.includes("Galian"));
    assert.equal(result.hotel_cards.length, 2);
  });
});
