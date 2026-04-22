import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createStore } from "../../src/store/store.ts";
import { loadConfig } from "../../src/store/config.ts";
import { startServer } from "../../src/http/server.ts";

type Harness = {
  server: Server;
  port: number;
  base: string;
};

async function boot(env: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({ YAP_BUFFER_SIZE: "20", YAP_RATE_LIMIT: "1000", ...env });
  const store = createStore(config);
  const { server, port } = await startServer(store, 0);
  return { server, port, base: `http://127.0.0.1:${port}` };
}

async function close(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => {
    h.server.closeAllConnections();
    h.server.close(() => resolve());
  });
}

async function post(
  h: Harness,
  path: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${h.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
    ...init,
  });
}

describe("HTTP integration", () => {
  let h: Harness;
  before(async () => {
    h = await boot();
  });
  after(async () => {
    await close(h);
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${h.base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("POST /api/join creates a channel, returns recent+cursor, sets nick cookie", async () => {
    const res = await post(h, "/api/join", { channel: "#dev", nick: "alice" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.recent, []);
    assert.equal(body.cursor, 0);
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie ?? "", /yap_nick=alice/);
  });

  it("POST /api/say appends, POST /api/poll returns it with mentions", async () => {
    await post(h, "/api/join", { channel: "#chat", nick: "alice" });
    await post(h, "/api/join", { channel: "#chat", nick: "bob" });
    const say = await post(h, "/api/say", {
      channel: "#chat",
      nick: "bob",
      message: "hi @alice",
    });
    assert.equal(say.status, 200);
    const poll = await post(h, "/api/poll", {
      channel: "#chat",
      nick: "alice",
      since_id: 0,
    });
    const body = await poll.json();
    assert.equal(body.messages.length, 1);
    assert.equal(body.mentions.length, 1);
    assert.equal(body.mentions[0].nick, "bob");
  });

  it("POST /api/listen long-polls and wakes when a matching message arrives", async () => {
    await post(h, "/api/join", { channel: "#alerts", nick: "alice" });
    const listening = post(h, "/api/listen", {
      channel: "#alerts",
      nick: "alice",
      mention: "alice",
      wait: 2,
    });
    setTimeout(async () => {
      await post(h, "/api/say", {
        channel: "#alerts",
        nick: "bob",
        message: "ping @alice",
      });
    }, 50);
    const res = await listening;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.matched, true);
    assert.equal(body.messages.length, 1);
  });

  it("POST /api/listen returns matched=false after wait elapses", async () => {
    await post(h, "/api/join", { channel: "#quiet", nick: "alice" });
    const res = await post(h, "/api/listen", {
      channel: "#quiet",
      nick: "alice",
      mention: "alice",
      wait: 0.1,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.matched, false);
  });

  it("POST /api/who returns the channel's current members", async () => {
    await post(h, "/api/join", { channel: "#room", nick: "alice" });
    await post(h, "/api/join", { channel: "#room", nick: "bob" });
    const res = await post(h, "/api/who", { channel: "#room", nick: "alice" });
    const body = await res.json();
    const nicks = body.members.map((m: { nick: string }) => m.nick).sort();
    assert.deepEqual(nicks, ["alice", "bob"]);
  });

  it("POST /api/history returns the channel buffer", async () => {
    await post(h, "/api/join", { channel: "#hist", nick: "alice" });
    for (let i = 0; i < 3; i++) {
      await post(h, "/api/say", { channel: "#hist", nick: "alice", message: `m${i}` });
    }
    const res = await post(h, "/api/history", { channel: "#hist", nick: "alice", limit: 2 });
    const body = await res.json();
    assert.equal(body.messages.length, 2);
    assert.deepEqual(body.messages.map((m: { text: string }) => m.text), ["m1", "m2"]);
  });

  it("password-gated channel rejects bad password and accepts correct one", async () => {
    await post(h, "/api/join", {
      channel: "#secret",
      nick: "alice",
      password: "hunter2",
    });
    const wrong = await post(h, "/api/join", {
      channel: "#secret",
      nick: "bob",
      password: "hunter3",
    });
    assert.equal(wrong.status, 403);
    const right = await post(h, "/api/join", {
      channel: "#secret",
      nick: "bob",
      password: "hunter2",
    });
    assert.equal(right.status, 200);
  });

  it("GET /mcp-config returns a paste-ready config blob", async () => {
    const res = await fetch(`${h.base}/mcp-config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.mcpServers?.yap?.url);
    assert.match(body.mcpServers.yap.url, /\/mcp$/);
  });

  it("GET / serves the web UI", async () => {
    const res = await fetch(`${h.base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const body = await res.text();
    assert.match(body, /<title>yap<\/title>/);
    assert.match(body, /app\.js/);
  });

  it("GET /app.js and /styles.css serve with correct content-types", async () => {
    const js = await fetch(`${h.base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    const css = await fetch(`${h.base}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /css/);
  });

  it("invalid JSON body returns 400", async () => {
    const res = await fetch(`${h.base}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
  });

  it("uses nick cookie when body omits nick", async () => {
    // First call sets the cookie
    const first = await post(h, "/api/join", { channel: "#cookied", nick: "carol" });
    const setCookie = first.headers.get("set-cookie");
    assert.ok(setCookie);
    const cookieValue = setCookie!.split(";")[0]; // "yap_nick=carol"
    const res = await post(
      h,
      "/api/say",
      { channel: "#cookied", message: "hi" },
      { headers: { cookie: cookieValue! } },
    );
    assert.equal(res.status, 200);
  });
});

describe("YAP_PASSWORD gating", () => {
  let h: Harness;
  before(async () => {
    h = await boot({ YAP_PASSWORD: "letmein" });
  });
  after(async () => {
    await close(h);
  });

  it("returns 401 without credentials on /mcp-config", async () => {
    const res = await fetch(`${h.base}/mcp-config`);
    assert.equal(res.status, 401);
  });

  it("returns 401 on /api/* without credentials", async () => {
    const res = await post(h, "/api/join", { channel: "#dev", nick: "alice" });
    assert.equal(res.status, 401);
  });

  it("accepts credentials on /api/* with Bearer", async () => {
    const res = await post(
      h,
      "/api/join",
      { channel: "#dev", nick: "alice" },
      { headers: { authorization: "Bearer letmein" } },
    );
    assert.equal(res.status, 200);
  });

  it("accepts the password via Bearer token", async () => {
    const res = await fetch(`${h.base}/mcp-config`, {
      headers: { authorization: "Bearer letmein" },
    });
    assert.equal(res.status, 200);
  });

  it("accepts the password via cookie", async () => {
    const res = await fetch(`${h.base}/mcp-config`, {
      headers: { cookie: "yap_server_auth=letmein" },
    });
    assert.equal(res.status, 200);
  });

  it("accepts the password via ?password= query param and seeds the auth cookie", async () => {
    const res = await fetch(`${h.base}/mcp-config?password=letmein`);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie ?? "", /yap_server_auth=letmein/);
  });

  it("rejects a wrong password via query param", async () => {
    const res = await fetch(`${h.base}/mcp-config?password=nope`);
    assert.equal(res.status, 401);
  });

  it("leaves /health ungated", async () => {
    const res = await fetch(`${h.base}/health`);
    assert.equal(res.status, 200);
  });
});

describe("/api/listen client disconnect", () => {
  let h: Harness;
  before(async () => {
    h = await boot();
  });
  after(async () => {
    await close(h);
  });

  it("removes the waiter when the client aborts mid-flight", async () => {
    await post(h, "/api/join", { channel: "#aborted", nick: "alice" });
    const ac = new AbortController();
    const pending = fetch(`${h.base}/api/listen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "#aborted",
        nick: "alice",
        mention: "alice",
        wait: 30,
      }),
      signal: ac.signal,
    }).catch((e) => e);
    // Let the request register a waiter server-side.
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    const result = await pending;
    assert.ok(result instanceof Error);
    // Give the server a tick to clean up.
    await new Promise((r) => setTimeout(r, 50));
    // Subsequent listen for a fresh wait shouldn't stall or misbehave.
    const res = await post(h, "/api/listen", {
      channel: "#aborted",
      nick: "alice",
      mention: "alice",
      wait: 0.1,
    });
    assert.equal(res.status, 200);
  });
});
