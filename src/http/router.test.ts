import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRouter, addRoute, setFallback, handle } from "./router.ts";

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (k: string, v: string) => void;
  end: (s?: string) => void;
};

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(s?: string) {
      if (s) this.body = s;
    },
  };
  return res;
}

function mockReq(method: string, url: string) {
  return { method, url } as unknown as Parameters<typeof handle>[1];
}

describe("router", () => {
  it("dispatches to a registered route", async () => {
    const r = createRouter();
    let called = false;
    addRoute(r, "GET", "/ping", async (_req, res) => {
      called = true;
      res.statusCode = 200;
      res.end("pong");
    });
    const res = mockRes();
    await handle(r, mockReq("GET", "/ping"), res as unknown as Parameters<typeof handle>[2]);
    assert.equal(called, true);
    assert.equal(res.body, "pong");
  });

  it("matches method case-insensitively", async () => {
    const r = createRouter();
    addRoute(r, "POST", "/api/say", async (_req, res) => {
      res.statusCode = 201;
      res.end("ok");
    });
    const res = mockRes();
    await handle(r, mockReq("post", "/api/say"), res as unknown as Parameters<typeof handle>[2]);
    assert.equal(res.statusCode, 201);
  });

  it("returns 404 with a JSON error for unmatched routes", async () => {
    const r = createRouter();
    const res = mockRes();
    await handle(r, mockReq("GET", "/missing"), res as unknown as Parameters<typeof handle>[2]);
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /error/);
    assert.equal(res.headers["content-type"], "application/json");
  });

  it("falls back to the fallback handler when no route matches", async () => {
    const r = createRouter();
    setFallback(r, async (_req, res) => {
      res.statusCode = 200;
      res.end("fallback");
    });
    const res = mockRes();
    await handle(r, mockReq("GET", "/unknown"), res as unknown as Parameters<typeof handle>[2]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, "fallback");
  });

  it("ignores query strings when matching paths", async () => {
    const r = createRouter();
    addRoute(r, "GET", "/mcp-config", async (_req, res) => {
      res.statusCode = 200;
      res.end("config");
    });
    const res = mockRes();
    await handle(
      r,
      mockReq("GET", "/mcp-config?format=json"),
      res as unknown as Parameters<typeof handle>[2],
    );
    assert.equal(res.body, "config");
  });
});
