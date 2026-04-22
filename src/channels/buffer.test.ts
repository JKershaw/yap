import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBuffer, append, since, recent, oldestId } from "./buffer.ts";
import type { Message } from "../messages/messages.ts";

function msg(id: number, text = "x"): Message {
  return {
    id,
    channel: "#dev",
    nick: "alice",
    text,
    type: "message",
    timestamp: id,
    mentions: [],
  };
}

describe("buffer", () => {
  describe("createBuffer", () => {
    it("starts empty", () => {
      const b = createBuffer(10);
      assert.equal(recent(b).length, 0);
      assert.equal(oldestId(b), undefined);
    });
  });

  describe("append", () => {
    it("adds a message to the buffer", () => {
      const b = createBuffer(10);
      append(b, msg(1));
      assert.equal(recent(b).length, 1);
    });

    it("drops the oldest message when over capacity", () => {
      const b = createBuffer(3);
      append(b, msg(1));
      append(b, msg(2));
      append(b, msg(3));
      append(b, msg(4));
      const all = recent(b);
      assert.deepEqual(all.map((m) => m.id), [2, 3, 4]);
    });

    it("keeps at most `capacity` messages", () => {
      const b = createBuffer(5);
      for (let i = 1; i <= 100; i++) append(b, msg(i));
      assert.equal(recent(b).length, 5);
      assert.deepEqual(recent(b).map((m) => m.id), [96, 97, 98, 99, 100]);
    });
  });

  describe("since", () => {
    it("returns messages with id strictly greater than sinceId", () => {
      const b = createBuffer(10);
      for (let i = 1; i <= 5; i++) append(b, msg(i));
      const result = since(b, 2);
      assert.deepEqual(result.map((m) => m.id), [3, 4, 5]);
    });

    it("returns empty when sinceId is at or past the latest", () => {
      const b = createBuffer(10);
      for (let i = 1; i <= 3; i++) append(b, msg(i));
      assert.deepEqual(since(b, 3), []);
      assert.deepEqual(since(b, 99), []);
    });

    it("returns the full buffer when sinceId is below the oldest", () => {
      const b = createBuffer(3);
      append(b, msg(10));
      append(b, msg(11));
      append(b, msg(12));
      const result = since(b, 0);
      assert.deepEqual(result.map((m) => m.id), [10, 11, 12]);
    });
  });

  describe("recent", () => {
    it("returns the tail up to limit, or everything if limit is omitted", () => {
      const b = createBuffer(10);
      for (let i = 1; i <= 5; i++) append(b, msg(i));
      assert.deepEqual(recent(b).map((m) => m.id), [1, 2, 3, 4, 5]);
      assert.deepEqual(recent(b, 2).map((m) => m.id), [4, 5]);
    });
  });

  describe("oldestId", () => {
    it("returns the id of the oldest message currently held", () => {
      const b = createBuffer(3);
      append(b, msg(1));
      append(b, msg(2));
      append(b, msg(3));
      append(b, msg(4));
      assert.equal(oldestId(b), 2);
    });
  });
});
