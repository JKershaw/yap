import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMentions } from "./mentions.ts";

describe("parseMentions", () => {
  it("returns an empty array when there are no mentions", () => {
    assert.deepEqual(parseMentions("hello world"), []);
  });

  it("extracts a single mention", () => {
    assert.deepEqual(parseMentions("hi @alice"), ["alice"]);
  });

  it("extracts multiple mentions", () => {
    assert.deepEqual(parseMentions("@alice @bob and @carol"), ["alice", "bob", "carol"]);
  });

  it("supports hyphens and underscores in nicks", () => {
    assert.deepEqual(parseMentions("@foo-bar @baz_qux"), ["foo-bar", "baz_qux"]);
  });

  it("supports digits in nicks", () => {
    assert.deepEqual(parseMentions("@agent42"), ["agent42"]);
  });

  it("deduplicates repeated mentions", () => {
    assert.deepEqual(parseMentions("@alice and @alice again"), ["alice"]);
  });

  it("does not treat bare @ as a mention", () => {
    assert.deepEqual(parseMentions("email me at @"), []);
  });

  it("matches @mentions in the middle of words by design (dumb parser)", () => {
    // The grammar is intentionally dumb per design.md.
    assert.deepEqual(parseMentions("see@alice"), ["alice"]);
  });

  it("handles punctuation after the nick", () => {
    assert.deepEqual(parseMentions("hey @alice, are you there?"), ["alice"]);
  });

  it("preserves case as written", () => {
    assert.deepEqual(parseMentions("@Alice"), ["Alice"]);
  });
});
