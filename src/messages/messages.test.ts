import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendMessage, messagesSince, historyOf } from "./messages.ts";
import { createBuffer } from "../channels/buffer.ts";

function makeChannel(capacity = 10) {
  return {
    name: "#dev",
    next_id: 1,
    buffer: createBuffer(capacity),
  };
}

describe("appendMessage", () => {
  it("allocates a monotonic id starting at 1", () => {
    const ch = makeChannel();
    const a = appendMessage(ch, "alice", "hi", "message");
    const b = appendMessage(ch, "alice", "again", "message");
    assert.equal(a.id, 1);
    assert.equal(b.id, 2);
  });

  it("stamps the channel name, nick, and type on the message", () => {
    const ch = makeChannel();
    const m = appendMessage(ch, "alice", "hi", "action");
    assert.equal(m.channel, "#dev");
    assert.equal(m.nick, "alice");
    assert.equal(m.type, "action");
    assert.equal(m.text, "hi");
  });

  it("parses mentions at ingest", () => {
    const ch = makeChannel();
    const m = appendMessage(ch, "alice", "ping @bob @carol", "message");
    assert.deepEqual(m.mentions, ["bob", "carol"]);
  });

  it("gives each message a timestamp", () => {
    const ch = makeChannel();
    const before = Date.now();
    const m = appendMessage(ch, "alice", "hi", "message");
    const after = Date.now();
    assert.ok(m.timestamp >= before && m.timestamp <= after);
  });

  it("appends to the ring buffer (drops oldest over capacity)", () => {
    const ch = makeChannel(2);
    appendMessage(ch, "a", "1", "message");
    appendMessage(ch, "a", "2", "message");
    appendMessage(ch, "a", "3", "message");
    const { messages } = messagesSince(ch, 0);
    assert.deepEqual(messages.map((m) => m.text), ["2", "3"]);
  });
});

describe("messagesSince", () => {
  it("returns only messages with id > sinceId", () => {
    const ch = makeChannel();
    appendMessage(ch, "a", "1", "message");
    appendMessage(ch, "a", "2", "message");
    appendMessage(ch, "a", "3", "message");
    const { messages, truncated, cursor } = messagesSince(ch, 1);
    assert.deepEqual(messages.map((m) => m.id), [2, 3]);
    assert.equal(truncated, false);
    assert.equal(cursor, 3);
  });

  it("returns the full buffer when sinceId is omitted", () => {
    const ch = makeChannel();
    appendMessage(ch, "a", "1", "message");
    appendMessage(ch, "a", "2", "message");
    const { messages, truncated } = messagesSince(ch);
    assert.equal(messages.length, 2);
    assert.equal(truncated, true);
  });

  it("flags truncated when sinceId is older than the buffer's oldest", () => {
    const ch = makeChannel(2);
    appendMessage(ch, "a", "1", "message");
    appendMessage(ch, "a", "2", "message");
    appendMessage(ch, "a", "3", "message");
    // sinceId=1 is older than the oldest held (id=2), so truncated=true
    const { messages, truncated } = messagesSince(ch, 1);
    assert.deepEqual(messages.map((m) => m.id), [2, 3]);
    assert.equal(truncated, true);
  });

  it("returns cursor equal to sinceId when no new messages", () => {
    const ch = makeChannel();
    appendMessage(ch, "a", "1", "message");
    const { messages, cursor } = messagesSince(ch, 5);
    assert.deepEqual(messages, []);
    assert.equal(cursor, 5);
  });

  it("cursor reflects latest id when messages are returned", () => {
    const ch = makeChannel();
    appendMessage(ch, "a", "1", "message");
    appendMessage(ch, "a", "2", "message");
    const { cursor } = messagesSince(ch, 0);
    assert.equal(cursor, 2);
  });

  it("cursor is 0 on an empty channel with no sinceId", () => {
    const ch = makeChannel();
    const { cursor } = messagesSince(ch);
    assert.equal(cursor, 0);
  });
});

describe("historyOf", () => {
  it("returns the last `limit` messages, or all when limit is omitted", () => {
    const ch = makeChannel();
    for (let i = 0; i < 5; i++) appendMessage(ch, "a", `m${i}`, "message");
    assert.equal(historyOf(ch).length, 5);
    assert.deepEqual(historyOf(ch, 2).map((m) => m.text), ["m3", "m4"]);
  });
});

describe("invariants", () => {
  it("poll(since=X) never returns messages with id ≤ X", () => {
    const ch = makeChannel(100);
    for (let i = 0; i < 50; i++) appendMessage(ch, "a", `m${i}`, "message");
    for (let x = 0; x < 50; x++) {
      const { messages } = messagesSince(ch, x);
      for (const m of messages) assert.ok(m.id > x);
    }
  });

  it("every message in the buffer has a unique id", () => {
    const ch = makeChannel(100);
    for (let i = 0; i < 100; i++) appendMessage(ch, "a", `m${i}`, "message");
    const ids = new Set<number>();
    const { messages } = messagesSince(ch, 0);
    for (const m of messages) {
      assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
      ids.add(m.id);
    }
  });

  it("ids remain monotonic and never reused across eviction", () => {
    // Fill the buffer many times over so most ids have been evicted.
    const ch = makeChannel(5);
    const allIdsEverReturned: number[] = [];
    for (let i = 0; i < 200; i++) {
      const m = appendMessage(ch, "a", `m${i}`, "message");
      allIdsEverReturned.push(m.id);
    }
    // Strictly increasing, no duplicates, even though the buffer only
    // holds 5 at any time.
    for (let i = 1; i < allIdsEverReturned.length; i++) {
      assert.ok(
        allIdsEverReturned[i]! > allIdsEverReturned[i - 1]!,
        `id ${allIdsEverReturned[i]} not greater than ${allIdsEverReturned[i - 1]}`,
      );
    }
    assert.equal(new Set(allIdsEverReturned).size, allIdsEverReturned.length);
  });
});
