import test from "node:test";
import assert from "node:assert/strict";
import { splitBookingRequest } from "../src/chat/booking-request.js";
import { DeltaFilter } from "../src/chat/stream-filter.js";

test("BOOKING line is parsed and hidden", () => {
  const r = splitBookingRequest('Відкриваю форму.\nBOOKING: {"hotel_id":123,"block_id":7}\nQUICK_REPLIES: a|b');
  assert.deepEqual(r.booking, { hotel_id: 123, block_id: 7 });
  assert.ok(!r.text.includes("BOOKING"));
  assert.ok(r.text.includes("QUICK_REPLIES"));
});

test("invalid BOOKING lines are dropped without an intent", () => {
  for (const bad of ['BOOKING: nope', 'BOOKING: {"hotel_id":"1"}', 'BOOKING: {"hotel_id":-4}', 'BOOKING: {"hotel_id":1.5}']) {
    const r = splitBookingRequest(`Text\n${bad}`);
    assert.equal(r.booking, undefined);
    assert.equal(r.text, "Text");
  }
});

test("stream filter never shows BOOKING", () => {
  const f = new DeltaFilter();
  let out = "";
  for (const c of ["Відкриваю ", "форму.\nBOOK", 'ING: {"hotel_id":1}']) out += f.push(c);
  out += f.flush();
  assert.ok(!out.includes("BOOKING"));
  assert.ok(out.includes("Відкриваю"));
});
