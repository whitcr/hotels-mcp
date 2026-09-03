import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { absolutePublicUrl, conciseText } from "../src/mappers/mapper.helpers.js";

describe("customer-facing sanitization", () => {
  it("keeps hotel links on the configured public origin", () => {
    assert.equal(
      absolutePublicUrl("https://evil.example/hotels/example", "https://hotels24.ua", "/hotel/1"),
      "https://hotels24.ua/hotels/example",
    );
  });

  it("removes HTML from descriptions", () => {
    assert.equal(conciseText("<script>alert(1)</script><b>Тихий готель</b> &amp; SPA"), "Тихий готель & SPA");
  });
});
