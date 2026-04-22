import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStore } from "../../src/store/store.ts";
import { loadConfig } from "../../src/store/config.ts";
import { startServer } from "../../src/http/server.ts";
import { createMcpHttpHandler } from "../../src/mcp/server.ts";

type Harness = {
  server: Server;
  port: number;
  url: string;
};

async function boot(env: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({ YAP_BUFFER_SIZE: "20", YAP_RATE_LIMIT: "1000", ...env });
  const store = createStore(config);
  const mcpHandler = createMcpHttpHandler(store);
  const { server, port } = await startServer(store, 0, mcpHandler);
  return { server, port, url: `http://127.0.0.1:${port}/mcp` };
}

async function close(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => {
    h.server.closeAllConnections();
    h.server.close(() => resolve());
  });
}

async function connect(h: Harness): Promise<Client> {
  const client = new Client({ name: "yap-test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(h.url));
  await client.connect(transport);
  return client;
}

function parseTextResult<T = unknown>(result: unknown): T {
  const r = result as { content: { type: string; text: string }[] };
  const first = r.content?.[0];
  if (!first || first.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as T;
}

describe("MCP conformance", () => {
  let h: Harness;
  before(async () => {
    h = await boot();
  });
  after(async () => {
    await close(h);
  });

  it("exposes the 7 v0.1.0 tools", async () => {
    const client = await connect(h);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["history", "join", "leave", "listen", "poll", "say", "who"]);
    await client.close();
  });

  it("tool: join returns recent + cursor", async () => {
    const client = await connect(h);
    const result = await client.callTool({
      name: "join",
      arguments: { channel: "#dev", nick: "alice" },
    });
    const body = parseTextResult<{ recent: unknown[]; cursor: number }>(result);
    assert.deepEqual(body.recent, []);
    assert.equal(body.cursor, 0);
    await client.close();
  });

  it("tool: say appends, poll returns it with separated mentions", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#chat", nick: "alice" },
    });
    await client.callTool({
      name: "join",
      arguments: { channel: "#chat", nick: "bob" },
    });
    await client.callTool({
      name: "say",
      arguments: { channel: "#chat", nick: "bob", message: "hi @alice" },
    });
    const res = await client.callTool({
      name: "poll",
      arguments: { channel: "#chat", nick: "alice", since_id: 0 },
    });
    const body = parseTextResult<{ messages: unknown[]; mentions: { nick: string }[] }>(res);
    assert.equal(body.messages.length, 1);
    assert.equal(body.mentions.length, 1);
    assert.equal(body.mentions[0]!.nick, "bob");
    await client.close();
  });

  it("tool: listen blocks and wakes on a matching message", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#wake", nick: "alice" },
    });
    const listening = client.callTool({
      name: "listen",
      arguments: { channel: "#wake", nick: "alice", mention: "alice", wait: 3 },
    });
    setTimeout(() => {
      void client.callTool({
        name: "say",
        arguments: { channel: "#wake", nick: "bob", message: "hi @alice" },
      });
    }, 50);
    const res = await listening;
    const body = parseTextResult<{ matched: boolean; messages: unknown[] }>(res);
    assert.equal(body.matched, true);
    assert.equal(body.messages.length, 1);
    await client.close();
  });

  it("tool: listen returns matched=false after wait elapses", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#quiet", nick: "alice" },
    });
    const res = await client.callTool({
      name: "listen",
      arguments: { channel: "#quiet", nick: "alice", mention: "alice", wait: 0.2 },
    });
    const body = parseTextResult<{ matched: boolean }>(res);
    assert.equal(body.matched, false);
    await client.close();
  });

  it("tool: who returns members", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#room", nick: "alice" },
    });
    await client.callTool({
      name: "join",
      arguments: { channel: "#room", nick: "bob" },
    });
    const res = await client.callTool({
      name: "who",
      arguments: { channel: "#room", nick: "alice" },
    });
    const body = parseTextResult<{ members: { nick: string }[] }>(res);
    const nicks = body.members.map((m) => m.nick).sort();
    assert.deepEqual(nicks, ["alice", "bob"]);
    await client.close();
  });

  it("tool: history returns the channel buffer", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#hist", nick: "alice" },
    });
    for (let i = 0; i < 3; i++) {
      await client.callTool({
        name: "say",
        arguments: { channel: "#hist", nick: "alice", message: `m${i}` },
      });
    }
    const res = await client.callTool({
      name: "history",
      arguments: { channel: "#hist", nick: "alice", limit: 2 },
    });
    const body = parseTextResult<{ messages: { text: string }[] }>(res);
    assert.deepEqual(body.messages.map((m) => m.text), ["m1", "m2"]);
    await client.close();
  });

  it("tool: leave removes the caller from who", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#bye", nick: "alice" },
    });
    await client.callTool({
      name: "leave",
      arguments: { channel: "#bye", nick: "alice" },
    });
    const res = await client.callTool({
      name: "who",
      arguments: { channel: "#bye", nick: "witness" },
    });
    const body = parseTextResult<{ members: { nick: string }[] }>(res);
    const nicks = body.members.map((m) => m.nick);
    assert.ok(!nicks.includes("alice"));
    await client.close();
  });

  it("tool: error responses set isError=true and include structuredContent.error", async () => {
    const client = await connect(h);
    const res = await client.callTool({
      name: "say",
      arguments: { channel: "#no-such", nick: "alice", message: "hi" },
    });
    const typed = res as {
      isError?: boolean;
      structuredContent?: { error?: string };
    };
    assert.equal(typed.isError, true);
    assert.ok(typed.structuredContent?.error);
    await client.close();
  });

  it("tool: join with correct password succeeds; wrong password errors", async () => {
    const client = await connect(h);
    const create = await client.callTool({
      name: "join",
      arguments: { channel: "#secret", nick: "alice", password: "hunter2" },
    });
    assert.equal((create as { isError?: boolean }).isError, undefined);
    const bad = await client.callTool({
      name: "join",
      arguments: { channel: "#secret", nick: "bob", password: "hunter3" },
    });
    assert.equal((bad as { isError?: boolean }).isError, true);
    const good = await client.callTool({
      name: "join",
      arguments: { channel: "#secret", nick: "bob", password: "hunter2" },
    });
    assert.equal((good as { isError?: boolean }).isError, undefined);
    await client.close();
  });

  it("tool: say auto-joins an existing channel on first call", async () => {
    const client = await connect(h);
    await client.callTool({
      name: "join",
      arguments: { channel: "#autojoin", nick: "alice" },
    });
    const say = await client.callTool({
      name: "say",
      arguments: { channel: "#autojoin", nick: "bob", message: "hi" },
    });
    assert.equal((say as { isError?: boolean }).isError, undefined);
    const who = await client.callTool({
      name: "who",
      arguments: { channel: "#autojoin", nick: "alice" },
    });
    const body = parseTextResult<{ members: { nick: string }[] }>(who);
    assert.ok(body.members.some((m) => m.nick === "bob"));
    await client.close();
  });

  it("tool: zod rejects malformed channel / nick before the handler runs", async () => {
    const client = await connect(h);
    const badChannel = await client.callTool({
      name: "join",
      arguments: { channel: "not-a-channel", nick: "alice" },
    });
    assert.equal((badChannel as { isError?: boolean }).isError, true);
    const badChannelText = JSON.stringify(badChannel);
    assert.match(badChannelText, /channel|invalid/i);

    const badNick = await client.callTool({
      name: "join",
      arguments: { channel: "#ok", nick: "bad nick with space" },
    });
    assert.equal((badNick as { isError?: boolean }).isError, true);
    await client.close();
  });
});

describe("MCP over YAP_PASSWORD-gated server", () => {
  let h: Harness;
  before(async () => {
    h = await boot({ YAP_PASSWORD: "letmein" });
  });
  after(async () => {
    await close(h);
  });

  it("fails to connect without credentials", async () => {
    const client = new Client({ name: "yap-test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(h.url));
    await assert.rejects(() => client.connect(transport));
  });

  it("connects with a Bearer token in requestInit.headers", async () => {
    const client = new Client({ name: "yap-test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(h.url), {
      requestInit: { headers: { Authorization: "Bearer letmein" } },
    });
    await client.connect(transport);
    const res = await client.callTool({
      name: "join",
      arguments: { channel: "#gated", nick: "alice" },
    });
    assert.equal((res as { isError?: boolean }).isError, undefined);
    await client.close();
  });

  it("/mcp-config includes a ready-to-paste Authorization header", async () => {
    const res = await fetch(`${h.url.replace("/mcp", "/mcp-config")}`, {
      headers: { authorization: "Bearer letmein" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mcpServers.yap.headers.Authorization, "Bearer letmein");
  });
});
