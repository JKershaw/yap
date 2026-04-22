import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createChannel, joinChannel, leaveChannel, touchMember, isMember } from "./channels.ts";

describe("createChannel", () => {
  it("starts empty with next_id=1 and the given buffer size", () => {
    const ch = createChannel("#dev", { bufferSize: 50 });
    assert.equal(ch.name, "#dev");
    assert.equal(ch.next_id, 1);
    assert.equal(ch.buffer.capacity, 50);
    assert.equal(ch.members.size, 0);
    assert.equal(ch.password_hash, undefined);
  });

  it("stores a password hash when a password is provided (never plaintext)", () => {
    const ch = createChannel("#secret", { bufferSize: 10, password: "hunter2" });
    assert.ok(ch.password_hash);
    assert.ok(!ch.password_hash!.includes("hunter2"));
  });
});

describe("joinChannel", () => {
  it("adds the nick as a member on a passwordless channel", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    const result = joinChannel(ch, "alice", undefined, 1000);
    assert.equal(result.ok, true);
    assert.ok(ch.members.has("alice"));
    assert.equal(ch.members.get("alice")!.joined_at, 1000);
    assert.equal(ch.members.get("alice")!.last_poll, 1000);
  });

  it("accepts the correct password", () => {
    const ch = createChannel("#secret", { bufferSize: 10, password: "hunter2" });
    const result = joinChannel(ch, "alice", "hunter2", 1000);
    assert.equal(result.ok, true);
  });

  it("rejects a missing password on a gated channel", () => {
    const ch = createChannel("#secret", { bufferSize: 10, password: "hunter2" });
    const result = joinChannel(ch, "alice", undefined, 1000);
    assert.equal(result.ok, false);
    assert.match(result.error!, /password/i);
  });

  it("rejects the wrong password", () => {
    const ch = createChannel("#secret", { bufferSize: 10, password: "hunter2" });
    const result = joinChannel(ch, "alice", "hunter3", 1000);
    assert.equal(result.ok, false);
  });

  it("is idempotent: re-joining refreshes last_poll, keeps joined_at", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 1000);
    joinChannel(ch, "alice", undefined, 5000);
    const m = ch.members.get("alice")!;
    assert.equal(m.joined_at, 1000);
    assert.equal(m.last_poll, 5000);
  });
});

describe("leaveChannel", () => {
  it("removes the nick from members", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 1000);
    leaveChannel(ch, "alice");
    assert.equal(ch.members.has("alice"), false);
  });

  it("is a no-op when the nick isn't a member", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    leaveChannel(ch, "alice");
    assert.equal(ch.members.size, 0);
  });
});

describe("touchMember", () => {
  it("updates last_poll for a member", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 1000);
    touchMember(ch, "alice", 2000);
    assert.equal(ch.members.get("alice")!.last_poll, 2000);
  });

  it("is a no-op for a non-member", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    touchMember(ch, "bob", 2000);
    assert.equal(ch.members.size, 0);
  });
});

describe("isMember", () => {
  it("returns true when the nick is in members", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    joinChannel(ch, "alice", undefined, 1000);
    assert.equal(isMember(ch, "alice"), true);
  });
  it("returns false otherwise", () => {
    const ch = createChannel("#dev", { bufferSize: 10 });
    assert.equal(isMember(ch, "alice"), false);
  });
});
