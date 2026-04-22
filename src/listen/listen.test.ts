import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createWaiters,
  waitForMatch,
  notifyWaiters,
  makePredicate,
} from "./listen.ts";
import type { Message } from "../messages/messages.ts";

function msg(partial: Partial<Message> = {}): Message {
  return {
    id: 1,
    channel: "#dev",
    nick: "alice",
    text: "hi",
    type: "message",
    timestamp: 1,
    mentions: [],
    ...partial,
  };
}

describe("makePredicate", () => {
  it("matches anything when no filters are set", () => {
    const p = makePredicate({});
    assert.equal(p(msg()), true);
  });

  it("requires the mention tag when provided", () => {
    const p = makePredicate({ mention: "alice" });
    assert.equal(p(msg({ mentions: ["alice"] })), true);
    assert.equal(p(msg({ mentions: ["bob"] })), false);
    assert.equal(p(msg({ mentions: [] })), false);
  });

  it("matches keyword case-insensitively", () => {
    const p = makePredicate({ keyword: "HELLO" });
    assert.equal(p(msg({ text: "well hello there" })), true);
    assert.equal(p(msg({ text: "no greetings here" })), false);
  });

  it("requires both to match when both are provided", () => {
    const p = makePredicate({ mention: "alice", keyword: "ship" });
    assert.equal(p(msg({ mentions: ["alice"], text: "ship it" })), true);
    assert.equal(p(msg({ mentions: ["alice"], text: "go home" })), false);
    assert.equal(p(msg({ mentions: ["bob"], text: "ship it" })), false);
  });
});

describe("waitForMatch", () => {
  it("resolves with the message when notify arrives before timeout", async () => {
    const waiters = createWaiters();
    const promise = waitForMatch(waiters, "#dev", () => true, 500);
    setImmediate(() => notifyWaiters(waiters, msg({ id: 42 })));
    const result = await promise;
    assert.equal(result?.id, 42);
  });

  it("resolves with null on timeout", async () => {
    const waiters = createWaiters();
    const result = await waitForMatch(waiters, "#dev", () => true, 20);
    assert.equal(result, null);
  });

  it("ignores messages from other channels", async () => {
    const waiters = createWaiters();
    const promise = waitForMatch(waiters, "#dev", () => true, 100);
    notifyWaiters(waiters, msg({ channel: "#other", id: 99 }));
    const result = await promise;
    assert.equal(result, null);
  });

  it("ignores messages that fail the predicate", async () => {
    const waiters = createWaiters();
    const promise = waitForMatch(
      waiters,
      "#dev",
      (m) => m.mentions.includes("alice"),
      50,
    );
    notifyWaiters(waiters, msg({ id: 1, mentions: ["bob"] }));
    const result = await promise;
    assert.equal(result, null);
  });

  it("wakes only the matching waiter when multiple are registered", async () => {
    const waiters = createWaiters();
    const pAlice = waitForMatch(
      waiters,
      "#dev",
      (m) => m.mentions.includes("alice"),
      200,
    );
    const pBob = waitForMatch(
      waiters,
      "#dev",
      (m) => m.mentions.includes("bob"),
      50,
    );
    notifyWaiters(waiters, msg({ id: 7, mentions: ["alice"] }));
    const [a, b] = await Promise.all([pAlice, pBob]);
    assert.equal(a?.id, 7);
    assert.equal(b, null);
  });

  it("can be aborted early by an external signal", async () => {
    const waiters = createWaiters();
    const ac = new AbortController();
    const promise = waitForMatch(waiters, "#dev", () => true, 5000, ac.signal);
    setImmediate(() => ac.abort());
    const result = await promise;
    assert.equal(result, null);
  });

  it("resolves immediately with null when the signal is already aborted", async () => {
    const waiters = createWaiters();
    const ac = new AbortController();
    ac.abort();
    const result = await waitForMatch(waiters, "#dev", () => true, 5000, ac.signal);
    assert.equal(result, null);
    assert.equal(waiters.set.size, 0);
  });

  it("removes the waiter from the registry on resolve", async () => {
    const waiters = createWaiters();
    const promise = waitForMatch(waiters, "#dev", () => true, 500);
    notifyWaiters(waiters, msg({ id: 1 }));
    await promise;
    assert.equal(waiters.set.size, 0);
  });

  it("removes the waiter from the registry on timeout", async () => {
    const waiters = createWaiters();
    await waitForMatch(waiters, "#dev", () => true, 10);
    assert.equal(waiters.set.size, 0);
  });
});
