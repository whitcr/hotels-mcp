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
    assert.deepEqual(events.slice(0, 3), ["delta:Let me check…", "status:resolving", "status:writing"]);
    assert.equal(events.slice(3).map(event => event.replace("delta:", "")).join(""), "Done Hotel");
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

describe("progress phases and timing", () => {
  const fakeStream = (response: unknown) => ({ on() { return this; }, finalResponse: async () => response });
  const callOf = (name: string) => ({ id: "t" + name, output: [{ type: "function_call", name, arguments: JSON.stringify({ hotel_ids: [1], hotel_id: 1, check_in: "2026-12-09", check_out: "2026-12-10", guests: 2, city_id: 1, budget_max: 1000, query: "x" }), call_id: "c" + name }] });

  it("names what the assistant is doing for each kind of tool call", async () => {
    for (const [tool, phase] of [["search_hotels", "searching"], ["check_hotel_availability", "availability"], ["get_hotel_details", "details"], ["resolve_destination", "resolving"]] as const) {
      const queue = [fakeStream(callOf(tool)), fakeStream({ id: "r", output: [], output_text: "Done." })];
      const chat = new HotelChat("k", "m", async () => ({}));
      (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), stream: () => queue.shift() } };
      const phases: string[] = [];
      await chat.respond("Hi", undefined, "en", { onDelta: () => undefined, onStatus: value => phases.push(value) });
      assert.deepEqual(phases, [phase, "writing"], tool);
    }
  });

  it("reports how long model rounds and tool calls took, and can lower the reasoning depth", async () => {
    const requests: any[] = [];
    const queue = [{ id: "a", output: callOf("resolve_destination").output }, { id: "b", output: [], output_text: "Done." }];
    const chat = new HotelChat("k", "m", async () => ({}), { reasoningEffort: "low" });
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => { requests.push(request); return queue.shift(); } } };
    const result = await chat.respond("Hi", undefined, "en");
    assert.equal(result.timing.model_ms.length, 2);
    assert.deepEqual(result.timing.tools.map(tool => tool.name), ["resolve_destination"]);
    assert(requests.every(request => request.reasoning?.effort === "low"));
    const plain: any[] = [];
    const normal = new HotelChat("k", "m", async () => ({}));
    (normal as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => { plain.push(request); return { id: "c", output: [], output_text: "Hi." }; } } };
    await normal.respond("Hi", undefined, "en");
    assert.equal(plain[0].reasoning, undefined);
  });
});

describe("quick replies marker in the middle of a line", () => {
  it("is hidden from the answer and from streamed text", () => {
    const glued = 'Please confirm the dates. QUICK_REPLIES: ["28.02 — 02.03","Other dates…"]';
    assert.deepEqual(splitQuickReplies(glued), { text: "Please confirm the dates.", quickReplies: ["28.02 — 02.03", "Other dates…"] });
    const filter = new DeltaFilter();
    const out = ["Please confirm the dates. QUICK_", 'REPLIES: ["A"', ',"B"]'].map(chunk => filter.push(chunk)).join("") + filter.flush();
    assert.equal(out, "Please confirm the dates.");
  });
});

describe("model compatibility and plain text", () => {
  it("retries without the reasoning depth when the model does not accept it, and remembers", async () => {
    const requests: any[] = [];
    const chat = new HotelChat("k", "gpt-6-luna", async () => ({}), { reasoningEffort: "minimal" });
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async (request: any) => {
      requests.push(request);
      if (request.reasoning) throw Object.assign(new Error("Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model."), { status: 400 });
      return { id: "r" + requests.length, output: [], output_text: "Hello." };
    } } };
    assert.equal((await chat.respond("Hi", undefined, "en")).message, "Hello.");
    assert.equal(requests.length, 2);
    await chat.respond("Hi again", undefined, "en");
    assert(!requests.at(-1).reasoning, "later requests no longer send it");
  });

  it("does not hide other API errors behind the retry", async () => {
    const chat = new HotelChat("k", "m", async () => ({}), { reasoningEffort: "low" });
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async () => { throw Object.assign(new Error("Rate limit"), { status: 429 }); } } };
    await assert.rejects(() => chat.respond("Hi", undefined, "en"), /Rate limit/);
  });

  it("removes bold markers from answers and from streamed text", async () => {
    const chat = new HotelChat("k", "m", async () => ({}));
    (chat as any).client = { responses: { retrieve: async () => ({ metadata: {} }), create: async () => ({ id: "r", output: [], output_text: "Dates: **20.12.2026** and **21.12.2026**." }) } };
    assert.equal((await chat.respond("Hi", undefined, "en")).message, "Dates: 20.12.2026 and 21.12.2026.");
    const filter = new DeltaFilter();
    const out = ["Dates: *", "*20.12.2026*", "* ok"].map(chunk => filter.push(chunk)).join("") + filter.flush();
    assert.equal(out, "Dates: 20.12.2026 ok");
  });
});
