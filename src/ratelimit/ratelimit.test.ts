import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, allow } from "./ratelimit.ts";

describe("ratelimit", () => {
  it("allows calls up to the limit within a window", () => {
    const rl = createRateLimiter(3, 60_000);
    const now = 1000;
    assert.equal(allow(rl, "alice", now), true);
    assert.equal(allow(rl, "alice", now), true);
    assert.equal(allow(rl, "alice", now), true);
    assert.equal(allow(rl, "alice", now), false);
  });

  it("resets after the window expires", () => {
    const rl = createRateLimiter(2, 60_000);
    const t0 = 1000;
    allow(rl, "alice", t0);
    allow(rl, "alice", t0);
    assert.equal(allow(rl, "alice", t0), false);
    // advance past window
    assert.equal(allow(rl, "alice", t0 + 60_001), true);
  });

  it("tracks different keys independently", () => {
    const rl = createRateLimiter(1, 60_000);
    assert.equal(allow(rl, "alice", 1000), true);
    assert.equal(allow(rl, "bob", 1000), true);
    assert.equal(allow(rl, "alice", 1000), false);
    assert.equal(allow(rl, "bob", 1000), false);
  });
});
