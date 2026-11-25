import assert from "node:assert/strict";
import { it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";

// Guards the prompt rules that came from customer feedback, so a later edit cannot silently drop them.
const rules: Array<[string, RegExp]> = [
  ["one night: budget total and period are the same", /exactly ONE NIGHT these are the same amount/],
  ["never hint that the hotel page has phone numbers", /"may have contacts" is also forbidden/],
  ["near the station means a 3 km hard filter", /railway",max_distance_m:3000/],
  ["never call a 17 km hotel nearby", /Never present a hotel 17 km away as "nearby"/],
  ["partial service matches are disclosed", /Disclose partial service matches/],
  ["minimum stay alternatives carry a warning", /minimum stay alternative/],
  ["range of prices without asking for a maximum", /without asking for another maximum/],
  ["offer pricier options after the range", /couple of more expensive choices/],
  ["different accommodation types for groups", /different supported accommodation types/],
  ["do not ask to reconfirm a complete request", /Never ask to reconfirm a complete request/],
  ["indoor or outdoor pool and no sauna plunge pool", /never count a sauna plunge pool/],
  ["group form and call center", /groups\/ and the Hotels24 call center \+380 98 039 33 49/],
  ["never re-ask the departure date", /Do not ask for a departure date already supplied/],
  ["budget is optional, search without it", /search without budget_max right away/],
  ["children's ages are asked", /children's ages/],
];

it("keeps every customer-feedback rule in the model instructions", async () => {
  let instructions = "";
  const chat = new HotelChat("k", "m", async () => ({}));
  (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => {
    instructions = request.instructions;
    return { id: "r", output: [], output_text: "Hello" };
  } } };
  await chat.respond("Hello");
  for (const [name, pattern] of rules) assert.match(instructions, pattern, name);
});
