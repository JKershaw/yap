import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextId } from "./ids.ts";

describe("nextId", () => {
  it("starts at the current next_id value", () => {
    const state = { next_id: 1 };
    assert.equal(nextId(state), 1);
  });

  it("increments next_id after each call", () => {
    const state = { next_id: 1 };
    nextId(state);
    assert.equal(state.next_id, 2);
  });

  it("produces a monotonic sequence", () => {
    const state = { next_id: 1 };
    const ids = [nextId(state), nextId(state), nextId(state), nextId(state)];
    assert.deepEqual(ids, [1, 2, 3, 4]);
  });

  it("never returns the same id twice", () => {
    const state = { next_id: 1 };
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const id = nextId(state);
      assert.ok(!seen.has(id), `id ${id} was reused`);
      seen.add(id);
    }
  });

  it("honours a custom starting value", () => {
    const state = { next_id: 42 };
    assert.equal(nextId(state), 42);
    assert.equal(nextId(state), 43);
  });
});
