import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { ChatGenerationError, UsageAccumulator } from "../src/chat/usage.js";
import { makeEvent } from "../src/logging/events.js";
import { ChatLogQueue } from "../src/logging/queue.js";

const usage = (input_tokens: number, output_tokens: number) => ({ input_tokens, output_tokens });
const answer = (id: string, tokens: unknown, text = "Please confirm your travel dates.") => ({ id, output: [], output_text: text, usage: tokens });
const tool = (id: string, tokens: unknown) => ({ id, usage: tokens, output: [{ type: "function_call", name: "resolve_destination", arguments: '{"query":"Lviv"}', call_id: "call-" + id }] });
function fake(responses: unknown[], retrieve?: () => Promise<unknown>) {
  const chat = new HotelChat("test-key", "test-model", async () => ({ destinations: [] }));
  (chat as any).client = { responses: { create: async () => {
    assert(responses.length, "unexpected model request");
    const next = responses.shift(); if (next instanceof Error) throw next; return next;
  }, retrieve } };
  return chat;
}

it("aggregates input/output usage across tools and presentation repair", async () => {
  const chat = fake([tool("one", usage(100, 10)), answer("two", usage(200, 20), "Будь ласка, уточніть дати подорожі."), answer("three", usage(300, 30))]);
  assert.deepEqual((await chat.respond("Find hotels in Lviv")).usage, usage(600, 60));
});

it("does not count retrieved previous-turn usage again", async () => {
  const chat = fake([answer("new", usage(50, 5))], async () => ({ metadata: { chat_language: "en" }, usage: usage(9999, 9999) }));
  assert.deepEqual((await chat.respond("3000", "old")).usage, usage(50, 5));
});

it("keeps unknown usage null and preserves legitimate zero counts", async () => {
  assert.deepEqual((await fake([answer("zero", usage(0, 0))]).respond("Find hotels in Lviv")).usage, usage(0, 0));
  const missing = await fake([tool("first", null), answer("last", usage(20, 2))]).respond("Find hotels in Lviv");
  assert.deepEqual(missing.usage, { input_tokens: null, output_tokens: null });
  const accumulator = new UsageAccumulator();
  accumulator.add({ input_tokens: -1, output_tokens: 3 });
  accumulator.add(usage(10, 2));
  assert.deepEqual(accumulator.snapshot(), { input_tokens: null, output_tokens: 5 });
});

it("preserves reported usage on a later transport error without inventing unknown costs", async () => {
  const cause = new Error("transport failed");
  await assert.rejects(fake([tool("one", usage(40, 4)), cause]).respond("Find hotels in Lviv"), (error: unknown) => {
    assert(error instanceof ChatGenerationError);
    assert.equal(error.cause, cause); assert.deepEqual(error.usage, usage(40, 4)); return true;
  });
  await assert.rejects(fake([cause]).respond("Find hotels in Lviv"), (error: unknown) => {
    assert(error instanceof ChatGenerationError);
    assert.deepEqual(error.usage, { input_tokens: null, output_tokens: null }); return true;
  });
});

it("counts both responses even if presentation validation ultimately fails", async () => {
  const bad = "Будь ласка, уточніть дати подорожі.";
  await assert.rejects(fake([answer("one", usage(10, 1), bad), answer("two", usage(20, 2), bad)]).respond("Find hotels in Lviv"), (error: unknown) => {
    assert(error instanceof ChatGenerationError);
    assert.match(error.message, /presentation validation/); assert.deepEqual(error.usage, usage(30, 3)); return true;
  });
});

it("keeps usage isolated between concurrent turns", async () => {
  const chat = new HotelChat("test-key", "test-model", async () => ({}));
  (chat as any).client = { responses: { create: async (params: any) => {
    const count = params.input.includes("Lviv") ? 10 : 20;
    await new Promise(resolve => setTimeout(resolve, count === 10 ? 10 : 0));
    return answer(String(count), usage(count, 1));
  } } };
  const results = await Promise.all([chat.respond("Find hotels in Lviv"), chat.respond("Find hotels in Kyiv")]);
  assert.deepEqual(results.map(result => result.usage), [usage(10, 1), usage(20, 1)]);
});

it("persists aggregated tokens unchanged through the BigQuery disk queue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "h24-token-queue-"));
  try {
    const result = await fake([tool("one", usage(100, 10)), answer("two", usage(200, 20))]).respond("Find hotels in Lviv");
    const context = { chat_id: "a".repeat(32), request_id: "b".repeat(24), environment: "local", chat_language: "en", chat_context: "search" };
    const row = makeEvent(context, { event_type: "assistant_message", role: "assistant", message: result.message, ...result.usage });
    const first = new ChatLogQueue(directory, async () => ({ failed: [0] }), () => {});
    await first.enqueue(row); await first.close();
    let delivered = false;
    const second = new ChatLogQueue(directory, async rows => {
      assert.equal(rows[0]?.input_tokens, 300); assert.equal(rows[0]?.output_tokens, 30);
      assert.equal(rows[0]?.event_id, row.event_id); delivered = true; return { failed: [] };
    }, () => {});
    await second.flush(); await second.close(); assert(delivered);
    assert.equal(makeEvent(context, { event_type: "user_message" }).input_tokens, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
