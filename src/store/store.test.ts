import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore, getOrCreateChannel, getChannel } from "./store.ts";
import { loadConfig } from "./config.ts";

function makeStore(envOverrides: Record<string, string> = {}) {
  const config = loadConfig({ YAP_BUFFER_SIZE: "50", ...envOverrides });
  return createStore(config);
}

describe("createStore", () => {
  it("starts with no channels and a fresh limiter", () => {
    const store = makeStore();
    assert.equal(store.channels.size, 0);
    assert.equal(store.rateLimiter.limit, 30);
    assert.equal(store.waiters.set.size, 0);
  });

  it("seeds the rate limiter from config.rateLimit", () => {
    const store = makeStore({ YAP_RATE_LIMIT: "7" });
    assert.equal(store.rateLimiter.limit, 7);
  });

  it("uses the injected clock", () => {
    const config = loadConfig({});
    const store = createStore(config, () => 42);
    assert.equal(store.clock(), 42);
  });
});

describe("getOrCreateChannel", () => {
  it("creates a channel on first access with buffer size from config", () => {
    const store = makeStore();
    const ch = getOrCreateChannel(store, "#dev");
    assert.equal(ch.name, "#dev");
    assert.equal(ch.buffer.capacity, 50);
  });

  it("returns the same channel on repeat access", () => {
    const store = makeStore();
    const first = getOrCreateChannel(store, "#dev");
    const second = getOrCreateChannel(store, "#dev");
    assert.equal(first, second);
  });

  it("applies a password on creation", () => {
    const store = makeStore();
    const ch = getOrCreateChannel(store, "#secret", "hunter2");
    assert.ok(ch.password_hash);
  });

  it("ignores a password argument when the channel already exists", () => {
    const store = makeStore();
    const first = getOrCreateChannel(store, "#secret", "hunter2");
    const second = getOrCreateChannel(store, "#secret", "hunter3");
    // same channel object; original hash preserved
    assert.equal(first, second);
    assert.equal(first.password_hash, second.password_hash);
  });
});

describe("getChannel", () => {
  it("returns undefined when the channel has not been created", () => {
    const store = makeStore();
    assert.equal(getChannel(store, "#dev"), undefined);
  });
  it("returns the channel when it exists", () => {
    const store = makeStore();
    getOrCreateChannel(store, "#dev");
    const ch = getChannel(store, "#dev");
    assert.equal(ch?.name, "#dev");
  });
});
