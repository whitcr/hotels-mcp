import assert from "node:assert/strict";
import { it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { splitQuickReplies } from "../src/chat/quick-replies.js";

it("returns context replies separately from the customer-facing chat message", async () => {
  const chat = new HotelChat("test-key", "test-model", async () => { throw new Error("Unexpected tool call"); });
  (chat as any).client = { responses: { create: async () => ({
    id: "test-response", output: [],
    output_text: 'Would you prefer an indoor or outdoor pool?\nQUICK_REPLIES: ["Indoor pool","Outdoor pool","Either is fine"]',
  }) } };
  const answer = await chat.respond("I want a hotel with a swimming pool.");
  assert.equal(answer.message, "Would you prefer an indoor or outdoor pool?");
  assert.deepEqual(answer.quick_replies, ["Indoor pool", "Outdoor pool", "Either is fine"]);
});

it("does not leak malformed metadata or present invalid or duplicate choices", () => {
  assert.deepEqual(splitQuickReplies('Would you like more options?\nQUICK_REPLIES: ["Incomplete'),
    { text: "Would you like more options?", quickReplies: [] });
  const options = ["Pool", "Pool", "<img>", "https://example.com", "A\nB", "x".repeat(121), "Spa", "Wi-Fi", "Parking", "Breakfast"];
  assert.deepEqual(splitQuickReplies("Choose a service.\nQUICK_REPLIES: " + JSON.stringify(options)),
    { text: "Choose a service.", quickReplies: ["Pool", "Spa", "Wi-Fi", "Parking"] });
  assert.deepEqual(splitQuickReplies("Thank you."), { text: "Thank you.", quickReplies: [] });
});
