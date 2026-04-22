import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classify, listActiveMembers } from "./presence.ts";
import { createChannel, joinChannel, touchMember } from "../channels/channels.ts";

const INACTIVE = 3600; // seconds
const EVICT = 43200;

describe("classify", () => {
  it("is active when idle time is below inactiveAfter", () => {
    const member = { joined_at: 0, last_poll: 0 };
    const now = 1000 * 1000; // 1000s later
    assert.equal(classify(member, now, INACTIVE, EVICT), "active");
  });

  it("is inactive when idle time is between inactiveAfter and evictAfter", () => {
    const member = { joined_at: 0, last_poll: 0 };
    const now = 10_000 * 1000;
    assert.equal(classify(member, now, INACTIVE, EVICT), "inactive");
  });

  it("is evicted when idle time is >= evictAfter", () => {
    const member = { joined_at: 0, last_poll: 0 };
    const now = 50_000 * 1000;
    assert.equal(classify(member, now, INACTIVE, EVICT), "evicted");
  });
});

describe("listActiveMembers", () => {
  it("returns all non-evicted members with seconds-ago and inactive flag", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 0);
    touchMember(ch, "alice", 500 * 1000); // 500s ago when now=1000s

    joinChannel(ch, "bob", undefined, 0);
    touchMember(ch, "bob", 0); // bob is stale

    const now = 1000 * 1000; // 1000s
    const members = listActiveMembers(ch, now, INACTIVE, EVICT);
    const alice = members.find((m) => m.nick === "alice")!;
    assert.equal(alice.inactive, false);
    assert.equal(alice.last_seen_seconds_ago, 500);

    const bob = members.find((m) => m.nick === "bob")!;
    assert.equal(bob.inactive, false); // 1000s idle, inactive threshold is 3600s
  });

  it("evicts members past evictAfter (lazy, removes from channel)", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 0);
    joinChannel(ch, "bob", undefined, 0);
    touchMember(ch, "bob", 50_000 * 1000);

    const now = 100_000 * 1000;
    const members = listActiveMembers(ch, now, INACTIVE, EVICT);
    // alice idle 100_000s > EVICT 43_200 → evicted
    assert.equal(members.find((m) => m.nick === "alice"), undefined);
    assert.equal(ch.members.has("alice"), false);
    // bob idle 50_000s > EVICT → also evicted
    assert.equal(ch.members.has("bob"), false);
  });

  it("marks members as inactive when idle > inactiveAfter but < evictAfter", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 0);
    const now = 10_000 * 1000; // 10,000s idle, >INACTIVE, <EVICT
    const [m] = listActiveMembers(ch, now, INACTIVE, EVICT);
    assert.equal(m!.inactive, true);
    assert.equal(m!.nick, "alice");
  });
});
