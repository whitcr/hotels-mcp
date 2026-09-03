import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("requires MCP auth in production", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production" }), /MCP_AUTH_TOKEN/);
  });

  it("accepts a complete production configuration", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      MCP_AUTH_TOKEN: "secret",
      HOTEL_PUBLIC_BASE_URL: "https://hotels24.ua",
      HOTELS_API_URL: "http://api.hotels24.stage/v1",
    });
    assert.equal(config.mcpAuthToken, "secret");
    assert.equal(config.requestRetries, 2);
  });
});
