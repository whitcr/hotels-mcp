import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterAvailabilityByBudget, mapAvailability, mapDestinations, mapHotelDetails, mergeSearchResults } from "../src/mappers/index.js";

describe("legacy response mappers", () => {
  it("maps destination sections", () => {
    const result = mapDestinations({
      hotels: [{ _id: 9, name: { uk: "Готель" }, city_id: 2 }],
      cities: [{ id: 2, name: "Львів" }],
      regions: [],
    }, "uk");
    assert.deepEqual(result, [
      { id: 9, type: "hotel", name: "Готель", cityId: 2, regionId: undefined },
      { id: 2, type: "city", name: "Львів", cityId: undefined, regionId: undefined },
    ]);
  });

  it("normalizes availability and selects the cheapest room", () => {
    const availability = mapAvailability({ result: [{
      _id: 9,
      arrival_date: "2026-09-10",
      departure_date: "2026-09-12",
      block: [
        { block_id: 10, block_price: 2000, min_price: { price: 4000, currency: "UAH" } },
        { block_id: 11, block_price: 1500, min_price: { price: 3000, currency: "UAH" } },
      ],
    }] });
    const details = mapHotelDetails([{
      hotel_id: 9,
      name: "Готель",
      class: 4,
      link_word: "/hotels/lviv/example.html",
      description: "<b>Затишний готель</b> у центрі міста.",
      facilities: [{ name: "Wi-Fi" }],
      latitude: 49.8,
      longitude: 24.0,
    }], "uk", "https://hotels24.ua");
    const result = mergeSearchResults(
      availability,
      details,
      "2026-09-10",
      "2026-09-12",
      10,
      "Потрібен готель з Wi-Fi",
      ["Wi-Fi"],
    );
    assert.equal(result[0]?.name, "Готель");
    assert.equal(result[0]?.totalPrice, 3000);
    assert.equal(result[0]?.availableRooms, 2);
    assert.equal(result[0]?.url, "https://hotels24.ua/hotels/lviv/example.html");
    assert.equal(result[0]?.shortDescription, "Затишний готель у центрі міста.");
    assert.deepEqual(result[0]?.matchReasons, ["Wi-Fi"]);
    assert.equal(result[0]?.matchScore, 1);

    const withinBudget = filterAvailabilityByBudget(availability, 3500, "total");
    assert.equal(withinBudget[0]?.rooms.length, 1);
    assert.equal(withinBudget[0]?.rooms[0]?.totalPrice, 3000);
  });
});
