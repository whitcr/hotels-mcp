import assert from "node:assert/strict";
import { it } from "node:test";
import { filterAvailabilityByBudget, mapAvailability, mergeSearchResults } from "../src/mappers/index.js";

const bed = {block_id:11917, price_type:2, max_occupancy:1, block_price:240, min_price:{price:480,currency:"UAH"}};
const room = {block_id:11915, price_type:1, max_occupancy:2, block_price:420, min_price:{price:840,currency:"UAH"}};
const payload = (blocks: unknown[]) => ({result:[{_id:3046,block:blocks}]});

it("prices beds for every guest and compares them fairly with whole rooms", () => {
  const result=mapAvailability(payload([bed,room]),2);
  assert.equal(result[0]!.rooms[0]!.totalPrice,960);
  assert.equal(result[0]!.rooms[0]!.pricePerNight,480);
  assert.equal(result[0]!.rooms[0]!.unitTotalPrice,480);
  assert.equal(result[0]!.rooms[0]!.quantity,2);
  assert.equal(result[0]!.rooms[0]!.priceBasis,"bed");
  assert.equal(result[0]!.rooms[1]!.totalPrice,840);
  assert.equal(result[0]!.rooms[1]!.quantity,1);
  assert.equal(filterAvailabilityByBudget(result,900,"total")[0]!.rooms[0]!.blockId,11915);
  assert.equal(filterAvailabilityByBudget(result,450,"per_night")[0]!.rooms[0]!.blockId,11915);
  const cheapest=mergeSearchResults(result,[],"2027-01-01","2027-01-03",5)[0]!;
  assert.equal(cheapest.totalPrice,840);
  assert.equal(cheapest.priceBasis,"room");
  assert.equal(cheapest.pricedGuests,2);
  assert.equal(cheapest.rooms[0]!.blockId,11915);
});

it("does not confuse bed occupancy with available beds, but respects known capacity", () => {
  assert.equal(mapAvailability(payload([bed]),2).length,1); // legacy filtered availability, then removed placesAvailable
  assert.equal(mapAvailability(payload([{...bed,placesAvailable:1}]),2).length,0);
  assert.equal(mapAvailability(payload([{...bed,placesAvailable:2}]),2).length,1);
  assert.equal(mapAvailability(payload([room]),3).length,0);
  assert.equal(mapAvailability(payload([{...room,placesAvailable:0}]),2).length,0);
});

it("does not invent currency, price unit, or a usable positive price", () => {
  for(const block of [
    {...bed,price_type:undefined}, {...bed,price_type:3},
    {...bed,min_price:{price:480,currency:"EUR"}}, {...bed,min_price:{price:480}},
    {...bed,min_price:{price:null,currency:"UAH"}},
    {...bed,block_price:0}, {...bed,block_price:-1}, {...bed,block_price:Infinity},
  ]) assert.equal(mapAvailability(payload([block]),2).length,0);
  const valid=mapAvailability(payload([room]),2);
  valid[0]!.rooms[0]!.currency="EUR";
  assert.equal(filterAvailabilityByBudget(valid,1000,"total").length,0);
});

it("rounds group prices to currency precision and rejects invalid guest counts", () => {
  const result=mapAvailability(payload([{...bed,block_price:0.1,min_price:{price:0.1,currency:"UAH"}}]),3);
  assert.equal(result[0]!.rooms[0]!.totalPrice,0.3);
  for(const guests of [0,-1,1.5,31,NaN])assert.throws(()=>mapAvailability(payload([bed]),guests));
});
