import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./passwords.ts";

describe("passwords", () => {
  it("verifies a password against its own hash", () => {
    const hash = hashPassword("hunter2");
    assert.equal(verifyPassword("hunter2", hash), true);
  });

  it("rejects the wrong password", () => {
    const hash = hashPassword("hunter2");
    assert.equal(verifyPassword("hunter3", hash), false);
  });

  it("produces different hashes for the same password (salted)", () => {
    const a = hashPassword("hunter2");
    const b = hashPassword("hunter2");
    assert.notEqual(a, b);
    assert.equal(verifyPassword("hunter2", a), true);
    assert.equal(verifyPassword("hunter2", b), true);
  });

  it("returns false for malformed hashes rather than throwing", () => {
    assert.equal(verifyPassword("any", "not-a-real-hash"), false);
    assert.equal(verifyPassword("any", ""), false);
  });

  it("never stores the plaintext password in the hash", () => {
    const hash = hashPassword("supersecret");
    assert.ok(!hash.includes("supersecret"));
  });
});
