import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { DeltaFilter } from "../src/chat/stream-filter.js";
import { splitQuickReplies } from "../src/chat/quick-replies.js";

const run = (chunks: string[]) => {
  const filter = new DeltaFilter();
  return chunks.map(chunk => filter.push(chunk)).join("") + filter.flush();
};

describe("streamed text filter", () => {
  it("never emits the hidden quick replies line, however it is split", () => {
    const text = 'Which pool?\nQUICK_REPLIES: ["Indoor","Outdoor"]';
    for (let cut = 1; cut < text.length; cut += 1) {
      assert.equal(run([text.slice(0, cut), text.slice(cut)]), "Which pool?", `split at ${cut}`);
    }
  });

  it("shows a Markdown link as its label, even when the link arrives in pieces", () => {
    const text = "Try [Hotel Lviv](https://hotels24.ua/uk/Hotel-5.html) today.";
    for (let cut = 1; cut < text.length; cut += 1) {
      assert.equal(run([text.slice(0, cut), text.slice(cut)]), "Try Hotel Lviv today.", `split at ${cut}`);
    }
  });

  it("flushes harmless text that merely looks like a marker or link start", () => {
    assert.equal(run(["Quick", " question [not a link"]), "Quick question [not a link");
    assert.equal(run(["Q"]), "Q");
  });

  it("keeps ordinary text and the draft ellipsis reply intact", () => {
    assert.equal(run(["Hello ", "there!"]), "Hello there!");
    assert.deepEqual(splitQuickReplies('Ages?\nQUICK_REPLIES: ["Two adults and two children, ages: …","Under 6"]').quickReplies,
      ["Two adults and two children, ages: …", "Under 6"]);
  });
});

describe("streaming chat turn", () => {
  const fakeStream = (response: unknown, deltas: string[]) => ({
    on(_event: string, listener: (event: { delta: string }) => void) { for (const delta of deltas) listener({ delta }); return this; },
    finalResponse: async () => response,
  });

  it("streams filtered text, reports the search phase and still returns the verified answer", async () => {
    const toolRound = { id: "r1", output: [{ type: "function_call", name: "resolve_destination", arguments: "{}", call_id: "c1" }] };
    const answer = { id: "r2", output: [], output_text: "Done [Hotel](https://hotels24.ua/uk/Hotel-5.html)\nQUICK_REPLIES: [\"More\"]" };
    const responses = [fakeStream(toolRound, ["Let me check…"]), fakeStream(answer, ["Done [Hotel](https://hotels24.ua/", "uk/Hotel-5.html)\nQUICK_", 'REPLIES: ["More"]'])];
    const chat = new HotelChat("k", "m", async () => ({ hotels: [{ id: 5, name: "Hotel", url: "https://hotels24.ua/uk/Hotel-5.html" }] }));
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), stream: () => responses.shift(), create: async () => { throw new Error("must stream"); } } };
    const events: string[] = [];
    const result = await chat.respond("Find hotels in Lviv", undefined, "en", {
      onDelta: text => events.push("delta:" + text), onStatus: phase => events.push("status:" + phase),
    });
    assert.deepEqual(events.slice(0, 2), ["delta:Let me check…", "status:searching"]);
    assert.equal(events.slice(2).map(event => event.replace("delta:", "")).join(""), "Done Hotel");
    assert.deepEqual(result.quick_replies, ["More"]);
    assert(!result.message.includes("QUICK_REPLIES"));
  });

  it("a broken hook never breaks the answer", async () => {
    const answer = { id: "r", output: [], output_text: "Hello" };
    const chat = new HotelChat("k", "m", async () => ({}));
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), stream: () => fakeStream(answer, ["Hello"]) } };
    const result = await chat.respond("Hi", undefined, "en", { onDelta: () => { throw new Error("socket closed"); } });
    assert.equal(result.message, "Hello");
  });
});
