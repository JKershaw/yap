import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
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
} from "./handlers.ts";
import {
  addRoute,
  createRouter,
  handle,
  setFallback,
  type RouteHandler,
  type Router,
} from "./router.ts";
import { mcpConfigHandler } from "./mcp-config.ts";

const NICK_COOKIE = "yap_nick";
const AUTH_COOKIE = "yap_server_auth";
const MAX_BODY_BYTES = 64 * 1024;
const WEB_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "web");

type ServerOptions = {
  store: Store;
  mcpHandler?: RouteHandler; // wired in from /src/mcp later
};

export function createHttpServer(opts: ServerOptions): http.Server {
  const router = buildRouter(opts);
  return http.createServer((req, res) => {
    handle(router, req, res).catch((err) => {
      // Safety net for anything a handler throws.
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "internal error" }));
      // eslint-disable-next-line no-console
      console.error("yap: unhandled request error", err);
    });
  });
}

export function buildRouter(opts: ServerOptions): Router {
  const { store, mcpHandler } = opts;
  const router = createRouter();

  const gated = (inner: RouteHandler): RouteHandler => {
    if (!store.config.serverPassword) return inner;
    return async (req, res) => {
      const authed = authSource(req, store.config.serverPassword!);
      if (authed === "none") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.setHeader("www-authenticate", 'Bearer realm="yap"');
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      // Seed the auth cookie when the password came in as a query
      // parameter, so subsequent requests don't leak it in URLs / logs.
      if (authed === "query") {
        const cookie = serializeCookie(AUTH_COOKIE, store.config.serverPassword!, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30,
        });
        const existing = res.getHeader("set-cookie");
        if (Array.isArray(existing)) res.setHeader("set-cookie", [...existing, cookie]);
        else if (typeof existing === "string") res.setHeader("set-cookie", [existing, cookie]);
        else res.setHeader("set-cookie", cookie);
      }
      await inner(req, res);
    };
  };

  // Tool endpoints
  addRoute(router, "POST", "/api/join", gated(apiRoute(store, joinHandler, { setNickCookie: true })));
  addRoute(router, "POST", "/api/leave", gated(apiRoute(store, leaveHandler)));
  addRoute(router, "POST", "/api/say", gated(apiRoute(store, sayHandler)));
  addRoute(router, "POST", "/api/poll", gated(apiRoute(store, pollHandler)));
  addRoute(router, "POST", "/api/listen", gated(apiRouteAsync(store, listenHandler)));
  addRoute(router, "POST", "/api/who", gated(apiRoute(store, whoHandler)));
  addRoute(router, "POST", "/api/history", gated(apiRoute(store, historyHandler)));
  addRoute(router, "POST", "/api/channels", gated(apiRouteNoArgs(store, listChannelsHandler)));

  // MCP config blob and (optional) MCP endpoint
  addRoute(
    router,
    "GET",
    "/mcp-config",
    gated(mcpConfigHandler({ serverPassword: store.config.serverPassword })),
  );
  if (mcpHandler) {
    addRoute(router, "POST", "/mcp", gated(mcpHandler));
    addRoute(router, "GET", "/mcp", gated(mcpHandler));
  }

  // Web UI
  addRoute(router, "GET", "/", gated(staticFileHandler("index.html", "text/html; charset=utf-8")));
  addRoute(router, "GET", "/app.js", gated(staticFileHandler("app.js", "application/javascript; charset=utf-8")));
  addRoute(router, "GET", "/styles.css", gated(staticFileHandler("styles.css", "text/css; charset=utf-8")));

  // Trivial health check (ungated so uptime monitors don't need the password)
  addRoute(router, "GET", "/health", (_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  setFallback(router, (_req, res) => {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "not found" }));
  });

  return router;
}

type SyncHandlerFn<A, T> = (store: Store, args: A) => Result<T>;
type AsyncHandlerFn<A, T> = (
  store: Store,
  args: A,
  signal?: AbortSignal,
) => Promise<Result<T>>;

function apiRoute<A extends { nick: string }, T>(
  store: Store,
  fn: SyncHandlerFn<A, T>,
  opts: { setNickCookie?: boolean } = {},
): RouteHandler {
  return async (req, res) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return writeError(res, 413, "body too large");
      return writeError(res, 400, "invalid json");
    }
    const nick = extractNick(req, body);
    if (!nick) return writeError(res, 400, "nick required");
    const args = { ...(body as object), nick } as A;
    const result = fn(store, args);
    writeResult(res, result, opts.setNickCookie ? nick : undefined);
  };
}

function apiRouteNoArgs<T>(
  store: Store,
  fn: (store: Store) => Result<T>,
): RouteHandler {
  return async (_req, res) => {
    writeResult(res, fn(store));
  };
}

function apiRouteAsync<A extends { nick: string }, T>(
  store: Store,
  fn: AsyncHandlerFn<A, T>,
): RouteHandler {
  return async (req, res) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return writeError(res, 413, "body too large");
      return writeError(res, 400, "invalid json");
    }
    const nick = extractNick(req, body);
    if (!nick) return writeError(res, 400, "nick required");
    const args = { ...(body as object), nick } as A;
    const ac = new AbortController();
    // `res` fires 'close' when the underlying connection is terminated,
    // whether or not `res.end()` has been called. That's the right signal
    // for aborting a still-in-flight long-poll when the client drops.
    const onClose = () => {
      if (!ac.signal.aborted) ac.abort();
    };
    res.once("close", onClose);
    const result = await fn(store, args, ac.signal);
    res.off("close", onClose);
    if (!res.writableEnded && !ac.signal.aborted) writeResult(res, result);
  };
}

function writeResult<T>(res: ServerResponse, result: Result<T>, setNickCookie?: string): void {
  res.setHeader("content-type", "application/json");
  const headers: string[] = [];
  if (setNickCookie) {
    headers.push(
      serializeCookie(NICK_COOKIE, setNickCookie, {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      }),
    );
  }
  if (headers.length > 0) res.setHeader("set-cookie", headers);
  if (result.ok) {
    res.statusCode = 200;
    res.end(JSON.stringify(result.value));
  } else {
    res.statusCode = result.status;
    res.end(JSON.stringify({ error: result.error }));
  }
}

function writeError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function extractNick(req: IncomingMessage, body: unknown): string | undefined {
  if (body && typeof body === "object" && "nick" in body) {
    const v = (body as Record<string, unknown>).nick;
    if (typeof v === "string" && v.length > 0) return v;
  }
  const header = req.headers["x-yap-nick"];
  if (typeof header === "string" && header.length > 0) return header;
  const cookieHeader = req.headers["cookie"];
  if (cookieHeader) {
    const cookies = parseCookie(cookieHeader);
    if (typeof cookies[NICK_COOKIE] === "string" && cookies[NICK_COOKIE]!.length > 0) {
      return cookies[NICK_COOKIE];
    }
  }
  return undefined;
}

type AuthSource = "bearer" | "cookie" | "query" | "none";

function authSource(req: IncomingMessage, password: string): AuthSource {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match && constantTimeEqual(match[1]!, password)) return "bearer";
  }
  const cookieHeader = req.headers["cookie"];
  if (cookieHeader) {
    const cookies = parseCookie(cookieHeader);
    const v = cookies[AUTH_COOKIE];
    if (typeof v === "string" && constantTimeEqual(v, password)) return "cookie";
  }
  // Allow `?password=...` on the initial request so the web UI can seed
  // the cookie — the gating wrapper rewrites this into an auth cookie so
  // the password doesn't keep riding along in URLs.
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryPassword = url.searchParams.get("password");
  if (queryPassword !== null && constantTimeEqual(queryPassword, password)) return "query";
  return "none";
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function staticFileHandler(filename: string, contentType: string): RouteHandler {
  const safeName = path.basename(filename);
  return async (_req, res) => {
    try {
      const body = await readFile(path.join(WEB_DIR, safeName));
      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "not found" }));
    }
  };
}

export function startServer(
  store: Store,
  port: number = store.config.port,
  mcpHandler?: RouteHandler,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer({ store, mcpHandler });
    server.once("error", reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actualPort });
    });
  });
}
