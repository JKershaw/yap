import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Store } from "../store/store.ts";
import {
  joinHandler,
  leaveHandler,
  sayHandler,
  pollHandler,
  listenHandler,
  whoHandler,
  historyHandler,
  listChannelsHandler,
  type Result,
} from "../http/handlers.ts";
import type { RouteHandler } from "../http/router.ts";

type ToolResponse = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toToolResponse<T>(r: Result<T>): ToolResponse {
  if (!r.ok) {
    const errorBody = { error: r.error };
    return {
      content: [{ type: "text", text: JSON.stringify(errorBody) }],
      structuredContent: errorBody,
      isError: true,
    };
  }
  const payload = r.value as Record<string, unknown>;
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

const nickSchema = z
  .string()
  .regex(/^[\w-]{1,32}$/, "nick must be 1-32 chars (word chars and hyphens)");
const channelSchema = z
  .string()
  .regex(/^[#&][\w-]{1,64}$/, "channel must start with # or & and be up to 64 chars");

/**
 * Creates a fresh McpServer with all yap tools registered. A new server +
 * transport is spun up per request so the endpoint is stateless — matches
 * PHILOSOPHY.md's "no hidden state" principle.
 */
export function createMcpServer(store: Store): McpServer {
  const server = new McpServer(
    { name: "yap", version: "0.1.0" },
    { capabilities: {} },
  );

  server.registerTool(
    "join",
    {
      description:
        "Join a channel. Creates it on first join. Returns recent buffer and a cursor for future polling.",
      inputSchema: {
        channel: channelSchema.describe("Channel name, e.g. #general"),
        nick: nickSchema.describe("Your nickname, scoped to this server"),
        password: z.string().optional().describe("Channel password if one is set"),
      },
    },
    async (args) => toToolResponse(joinHandler(store, args)),
  );

  server.registerTool(
    "leave",
    {
      description: "Leave a channel. Does not delete the channel.",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
      },
    },
    async (args) => toToolResponse(leaveHandler(store, args)),
  );

  server.registerTool(
    "say",
    {
      description:
        "Append a message to a channel. Set type='action' for a /me-style action.",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
        message: z.string().describe("Message body; @mentions are parsed server-side"),
        type: z.enum(["message", "action"]).optional(),
        password: z.string().optional(),
      },
    },
    async (args) => toToolResponse(sayHandler(store, args)),
  );

  server.registerTool(
    "poll",
    {
      description:
        "Non-blocking fetch of new messages since `since_id`. Mentions of the caller are returned separately.",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
        since_id: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => toToolResponse(pollHandler(store, args)),
  );

  server.registerTool(
    "listen",
    {
      description:
        "Long-poll variant of `poll`. Blocks up to `wait` seconds (max 30) until a message matching the optional predicate arrives.",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
        mention: z.string().optional().describe("Only match if this nick is tagged"),
        keyword: z.string().optional().describe("Only match if body contains this substring (case-insensitive)"),
        wait: z.number().positive().max(30).optional(),
        since_id: z.number().int().nonnegative().optional(),
      },
    },
    async (args, extra) => toToolResponse(await listenHandler(store, args, extra.signal)),
  );

  server.registerTool(
    "who",
    {
      description: "List active members of a channel with time-ago and an inactive flag.",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
      },
    },
    async (args) => toToolResponse(whoHandler(store, args)),
  );

  server.registerTool(
    "history",
    {
      description: "Return the last `limit` messages from the channel buffer (default: full buffer).",
      inputSchema: {
        channel: channelSchema,
        nick: nickSchema,
        limit: z.number().int().positive().optional(),
      },
    },
    async (args) => toToolResponse(historyHandler(store, args)),
  );

  server.registerTool(
    "list_channels",
    {
      description:
        "List all channels on this server with current member counts. No arguments.",
      inputSchema: {},
    },
    async () => toToolResponse(listChannelsHandler(store)),
  );

  return server;
}

/**
 * HTTP route handler for the /mcp endpoint. A fresh McpServer +
 * StreamableHTTPServerTransport are created per request so each call is
 * independent; state lives exclusively in `store`.
 */
export function createMcpHttpHandler(store: Store): RouteHandler {
  return async (req, res) => {
    const server = createMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "internal error" },
            id: null,
          }),
        );
      }
      // eslint-disable-next-line no-console
      console.error("yap: mcp request error", err);
    }
  };
}
