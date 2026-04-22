import type { RouteHandler } from "./router.ts";

/**
 * Returns a paste-ready MCP client config blob for the local server.
 * See DESIGN.md → MCP endpoint. The scheme comes from the first entry of
 * the (potentially comma-separated) X-Forwarded-Proto header; Host is
 * trusted as-is — operators behind reverse proxies should strip or
 * normalise Host upstream.
 *
 * When the server is gated by YAP_PASSWORD, the blob includes a
 * pre-populated Authorization header so the pasted config just works.
 * This endpoint is already behind the same gate, so the password is only
 * exposed to someone who already has it.
 */
export function mcpConfigHandler(opts: { serverPassword?: string } = {}): RouteHandler {
  return (req, res) => {
    const host = req.headers["host"] ?? "localhost";
    const fwd = req.headers["x-forwarded-proto"];
    const proto = typeof fwd === "string" ? (fwd.split(",")[0] ?? "http").trim() : "http";
    const scheme = proto === "https" ? "https" : "http";
    const url = `${scheme}://${host}/mcp`;
    const entry: { url: string; headers?: Record<string, string> } = { url };
    if (opts.serverPassword) {
      entry.headers = { Authorization: `Bearer ${opts.serverPassword}` };
    }
    const body = { mcpServers: { yap: entry } };
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body, null, 2));
  };
}
