import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";
import { HotelChat } from "../src/chat/hotel-chat.js";
import { searchHotelsInput } from "../src/schemas/hotel.schemas.js";
import { registerSearchHotels } from "../src/tools/search-hotels.js";

it("sends updated policy every turn and rejects non-read-only tool calls", async () => {
  const requests: any[] = [];
  let dispatched = 0;
  const chat = new HotelChat("test-key-not-real", "test-model", async () => { dispatched++; });
  (chat as any).client = { responses: { create: async (request: any) => {
    requests.push(request);
    return requests.length === 1
      ? {id:"r1", output:[{type:"function_call", name:"create_booking", arguments:"{}", call_id:"c1"}]}
      : {id:"r2", output:[], output_text:"Use Hotels24."};
  } } };
  await chat.respond("Other options please", "previous");
  assert.equal(dispatched, 0);
  assert.equal(requests[0].previous_response_id, "previous");
  for (const request of requests) {
    assert.match(request.instructions, /ONE NIGHT/);
    assert.match(request.instructions, /DD.MM.YYYY/);
    assert.match(request.instructions, /Never display them/);
    assert.match(request.instructions, /Never recommend Booking.com/);
    assert.match(request.instructions, /NEW search/);
    assert.match(request.instructions, /No dedicated booking phone/);
    assert.match(request.instructions, /does NOT publish direct owner\/hotel phone contacts/);
    assert.match(request.instructions, /Proximity is a REQUIRED constraint/);
  }
  assert.match(requests[1].input[0].output, /Only read-only/);
  assert(requests[0].tools.find((t: any) => t.name === "search_hotels").parameters.properties.exclude_hotel_ids);
});

it("excludes previous hotels before candidate slicing and does not return them on an empty result", async () => {
  let callback: any;
  const detailsCalls: number[][] = [];
  registerSearchHotels({registerTool: (_name: string, _config: unknown, cb: any) => {callback=cb;}} as any, {
    maxResults: 1, hotelPublicBaseUrl:"https://hotels24.ua",
    client: {
      getAvailability: async () => ({result:[1,2,3].map(id => ({_id:id, block:[{block_id:id, block_price:1000, min_price:{price:1000,currency:"UAH"}}]}))}),
      getHotelDetails: async (ids: number[]) => {detailsCalls.push(ids);return ids.map(id => ({hotel_id:id,name:'Hotel '+id,link_word:'/hotel/'+id}));},
    },
  } as any);
  const args=z.object(searchHotelsInput).parse({city_id:1,check_in:"2099-01-01",check_out:"2099-01-02",guests:2,budget_max:3000,budget_type:"total",budget_currency:"UAH",exclude_hotel_ids:[1,2]});
  const result=await callback(args);
  assert.equal(result.isError, undefined);
  assert.deepEqual(detailsCalls,[[3]]);
  assert.equal(result.structuredContent.hotels[0].id,3);
  const empty=await callback({...args,exclude_hotel_ids:[1,2,3]});
  assert.equal(empty.structuredContent.hotels.length,0);
  assert.equal(detailsCalls.length,1);
  assert.equal(z.object(searchHotelsInput).safeParse({...args,exclude_hotel_ids:[-1]}).success,false);
});
