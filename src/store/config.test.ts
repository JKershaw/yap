import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("applies documented defaults when env is empty", () => {
    const c = loadConfig({});
    assert.equal(c.port, 0);
    assert.equal(c.serverPassword, undefined);
    assert.equal(c.bufferSize, 200);
    assert.equal(c.inactiveAfterSec, 3600);
    assert.equal(c.evictAfterSec, 43200);
    assert.equal(c.rateLimit, 30);
  });

  it("maps env vars to domain-shaped keys", () => {
    const c = loadConfig({
      YAP_PORT: "8080",
      YAP_BUFFER_SIZE: "100",
      YAP_INACTIVE_AFTER: "60",
      YAP_EVICT_AFTER: "120",
      YAP_RATE_LIMIT: "5",
      YAP_PASSWORD: "letmein",
    });
    assert.equal(c.port, 8080);
    assert.equal(c.bufferSize, 100);
    assert.equal(c.inactiveAfterSec, 60);
    assert.equal(c.evictAfterSec, 120);
    assert.equal(c.rateLimit, 5);
    assert.equal(c.serverPassword, "letmein");
  });

  it("throws on invalid numeric input", () => {
    assert.throws(() => loadConfig({ YAP_PORT: "not-a-number" }));
  });

  it("rejects non-positive buffer sizes", () => {
    assert.throws(() => loadConfig({ YAP_BUFFER_SIZE: "0" }));
    assert.throws(() => loadConfig({ YAP_BUFFER_SIZE: "-1" }));
  });

  it("treats an empty YAP_PASSWORD as unset (no gate)", () => {
    const c = loadConfig({ YAP_PASSWORD: "" });
    assert.equal(c.serverPassword, undefined);
  });
});
