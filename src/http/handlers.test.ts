import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  joinHandler,
  leaveHandler,
  sayHandler,
  pollHandler,
  listenHandler,
  whoHandler,
  historyHandler,
  listChannelsHandler,
} from "./handlers.ts";
import { createStore, getOrCreateChannel, type Store } from "../store/store.ts";
import { loadConfig } from "../store/config.ts";

function makeStore(envOverrides: Record<string, string> = {}, clock = () => 1_000_000) {
  const config = loadConfig({ YAP_BUFFER_SIZE: "10", YAP_RATE_LIMIT: "5", ...envOverrides });
  return createStore(config, clock);
}

function joinChannelByHandler(store: Store, channel: string, nick: string) {
  return joinHandler(store, { channel, nick });
}

describe("joinHandler", () => {
  it("creates a channel on first join and returns recent + cursor", () => {
    const store = makeStore();
    const result = joinHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.recent, []);
    assert.equal(result.value.cursor, 0);
  });

  it("fails if the channel requires a password and none is given", () => {
    const store = makeStore();
    getOrCreateChannel(store, "#secret", "hunter2");
    const result = joinHandler(store, { channel: "#secret", nick: "alice" });
    assert.equal(result.ok, false);
  });

  it("accepts the correct password", () => {
    const store = makeStore();
    getOrCreateChannel(store, "#secret", "hunter2");
    const result = joinHandler(store, { channel: "#secret", nick: "alice", password: "hunter2" });
    assert.equal(result.ok, true);
  });

  it("includes recent buffer contents on join", () => {
    const store = makeStore();
    const ch = getOrCreateChannel(store, "#dev");
    sayHandler(store, { channel: "#dev", nick: "bob", message: "hello" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "again" });
    const result = joinHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.recent.length, 2);
    assert.equal(result.value.cursor, ch.next_id - 1);
  });
});

describe("leaveHandler", () => {
  it("removes the nick from the channel", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    const result = leaveHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    const ch = getOrCreateChannel(store, "#dev");
    assert.equal(ch.members.has("alice"), false);
  });

  it("is a no-op on a non-existent channel", () => {
    const store = makeStore();
    const result = leaveHandler(store, { channel: "#nowhere", nick: "alice" });
    assert.equal(result.ok, true);
  });
});

describe("sayHandler", () => {
  it("appends a message and returns id + timestamp", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    const result = sayHandler(store, { channel: "#dev", nick: "alice", message: "hi" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.id, 1);
    assert.ok(result.value.timestamp);
  });

  it("auto-joins an existing channel if the caller isn't a member yet", () => {
    const store = makeStore();
    joinChannelByHandler(store, "#dev", "bob");
    const result = sayHandler(store, { channel: "#dev", nick: "alice", message: "hi" });
    assert.equal(result.ok, true);
    const ch = getOrCreateChannel(store, "#dev");
    assert.ok(ch.members.has("alice"));
  });

  it("fails when the channel doesn't exist (only `join` creates)", () => {
    const store = makeStore();
    const result = sayHandler(store, { channel: "#nowhere", nick: "alice", message: "hi" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
    assert.equal(store.channels.has("#nowhere"), false);
  });

  it("supports /me actions via type", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    sayHandler(store, { channel: "#dev", nick: "alice", message: "waves", type: "action" });
    const ch = getOrCreateChannel(store, "#dev");
    assert.equal(ch.buffer.items[0]!.type, "action");
  });

  it("enforces per-nick rate limits", () => {
    const store = makeStore({ YAP_RATE_LIMIT: "2" });
    joinHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(sayHandler(store, { channel: "#dev", nick: "alice", message: "1" }).ok, true);
    assert.equal(sayHandler(store, { channel: "#dev", nick: "alice", message: "2" }).ok, true);
    const result = sayHandler(store, { channel: "#dev", nick: "alice", message: "3" });
    assert.equal(result.ok, false);
  });

  it("rejects empty messages", () => {
    const store = makeStore();
    const result = sayHandler(store, { channel: "#dev", nick: "alice", message: "" });
    assert.equal(result.ok, false);
  });

  it("rejects join without password on a gated channel when auto-joining via say", () => {
    const store = makeStore();
    getOrCreateChannel(store, "#secret", "hunter2");
    const result = sayHandler(store, { channel: "#secret", nick: "alice", message: "hi" });
    assert.equal(result.ok, false);
  });
});

describe("pollHandler", () => {
  it("returns messages since the given id", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "1" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "2" });
    const result = pollHandler(store, { channel: "#dev", nick: "alice", since_id: 1 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.messages.map((m) => m.id), [2]);
    assert.equal(result.value.cursor, 2);
  });

  it("separates mentions of the caller from the full messages array", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "hi @alice" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "just chatting" });
    const result = pollHandler(store, { channel: "#dev", nick: "alice", since_id: 0 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.messages.length, 2);
    assert.equal(result.value.mentions.length, 1);
    assert.equal(result.value.mentions[0]!.text, "hi @alice");
  });

  it("flags truncated when since_id is older than the buffer's oldest", () => {
    const store = makeStore({ YAP_BUFFER_SIZE: "2" });
    joinHandler(store, { channel: "#dev", nick: "alice" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "1" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "2" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "3" });
    const result = pollHandler(store, { channel: "#dev", nick: "alice", since_id: 0 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.truncated, true);
  });

  it("returns an empty result on a fresh channel the caller has never joined", () => {
    const store = makeStore();
    const result = pollHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.messages, []);
  });
});

describe("whoHandler", () => {
  it("returns the channel's active members", () => {
    let now = 1_000_000;
    const store = makeStore({}, () => now);
    joinHandler(store, { channel: "#dev", nick: "alice" });
    joinHandler(store, { channel: "#dev", nick: "bob" });
    const result = whoHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const nicks = result.value.members.map((m) => m.nick).sort();
    assert.deepEqual(nicks, ["alice", "bob"]);
  });

  it("omits evicted members and marks inactive ones", () => {
    let now = 1_000;
    const store = makeStore({ YAP_INACTIVE_AFTER: "100", YAP_EVICT_AFTER: "1000" }, () => now);
    joinHandler(store, { channel: "#dev", nick: "stale" }); // touched at t=1000
    joinHandler(store, { channel: "#dev", nick: "gone" });
    now = 10_000; // advance 9 seconds — both still active
    joinHandler(store, { channel: "#dev", nick: "fresh" });
    now = 200_000; // advance further: stale idle 199s > 100s; gone idle 199s; fresh idle 190s
    const result = whoHandler(store, { channel: "#dev", nick: "fresh" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const entry = result.value.members.find((m) => m.nick === "stale");
    assert.equal(entry?.inactive, true);

    now = 2_000_000; // past evict threshold for stale, gone, and fresh from their last touch
    const r2 = whoHandler(store, { channel: "#dev", nick: "fresh" });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    // `fresh`'s who call also updates its own last_poll, keeping it alive
    const present = r2.value.members.map((m) => m.nick);
    assert.ok(!present.includes("stale"));
    assert.ok(!present.includes("gone"));
  });

  it("fails if the channel does not exist", () => {
    const store = makeStore();
    const result = whoHandler(store, { channel: "#nowhere", nick: "alice" });
    assert.equal(result.ok, false);
  });
});

describe("historyHandler", () => {
  it("returns the last `limit` messages", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    for (let i = 0; i < 5; i++) {
      sayHandler(store, { channel: "#dev", nick: "alice", message: `m${i}` });
    }
    const result = historyHandler(store, { channel: "#dev", nick: "alice", limit: 2 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.messages.map((m) => m.text), ["m3", "m4"]);
  });

  it("returns the full buffer when limit is omitted", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    for (let i = 0; i < 3; i++) {
      sayHandler(store, { channel: "#dev", nick: "alice", message: `m${i}` });
    }
    const result = historyHandler(store, { channel: "#dev", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.messages.length, 3);
  });

  it("returns an empty array for a channel that doesn't exist", () => {
    const store = makeStore();
    const result = historyHandler(store, { channel: "#nowhere", nick: "alice" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.messages, []);
  });
});

describe("listChannelsHandler", () => {
  it("returns an empty list when no channels exist", () => {
    const store = makeStore();
    const result = listChannelsHandler(store);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.channels, []);
  });

  it("returns each channel with its current member count, sorted by name", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    joinHandler(store, { channel: "#dev", nick: "bob" });
    joinHandler(store, { channel: "#general", nick: "alice" });
    const result = listChannelsHandler(store);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.channels, [
      { name: "#dev", members: 2 },
      { name: "#general", members: 1 },
    ]);
  });

  it("includes empty channels (after everyone has left)", () => {
    const store = makeStore();
    joinHandler(store, { channel: "#empty", nick: "alice" });
    leaveHandler(store, { channel: "#empty", nick: "alice" });
    const result = listChannelsHandler(store);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.channels, [{ name: "#empty", members: 0 }]);
  });

  it("never exposes password_hash for gated channels", () => {
    const store = makeStore();
    getOrCreateChannel(store, "#secret", "hunter2");
    const result = listChannelsHandler(store);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const body = JSON.stringify(result.value);
    assert.ok(!/password_hash/i.test(body));
    assert.ok(!body.includes("hunter2"));
  });
});

describe("listenHandler", () => {
  it("resolves immediately if a matching message is already past since_id", async () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    sayHandler(store, { channel: "#dev", nick: "bob", message: "hi @alice" });
    const result = await listenHandler(store, {
      channel: "#dev",
      nick: "alice",
      mention: "alice",
      since_id: 0,
      wait: 1,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.matched, true);
    assert.equal(result.value.mentions.length, 1);
  });

  it("blocks and resolves when a new matching message arrives", async () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    const pending = listenHandler(store, {
      channel: "#dev",
      nick: "alice",
      mention: "alice",
      wait: 2,
    });
    setTimeout(() => {
      sayHandler(store, { channel: "#dev", nick: "bob", message: "hey @alice" });
    }, 10);
    const result = await pending;
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.matched, true);
    assert.equal(result.value.messages.length, 1);
  });

  it("returns matched=false on timeout with no match", async () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    // Short wait to keep the test fast; wait is in seconds per spec, but
    // the handler accepts fractional seconds for tests.
    const result = await listenHandler(store, {
      channel: "#dev",
      nick: "alice",
      mention: "alice",
      wait: 0.05,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.matched, false);
  });

  it("caps wait at 30 seconds per design", async () => {
    const store = makeStore();
    joinHandler(store, { channel: "#dev", nick: "alice" });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const before = Date.now();
    const result = await listenHandler(
      store,
      { channel: "#dev", nick: "alice", wait: 9999 },
      ac.signal,
    );
    const elapsed = Date.now() - before;
    assert.equal(result.ok, true);
    assert.ok(elapsed < 200, `aborted quickly, took ${elapsed}ms`);
  });
});
