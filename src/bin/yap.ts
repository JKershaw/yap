#!/usr/bin/env -S node --experimental-strip-types --no-warnings
import { createStore } from "../store/store.ts";
import { loadConfig } from "../store/config.ts";
import { startServer } from "../http/server.ts";
import { createMcpHttpHandler } from "../mcp/server.ts";

const [, , subcommand, ...rest] = process.argv;

switch (subcommand ?? "server") {
  case "server":
  case undefined:
    await runServer();
    break;
  case "mcp":
    printMcpConfig(rest);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`yap: unknown subcommand '${subcommand}'`);
    printHelp();
    process.exit(1);
}

async function runServer(): Promise<void> {
  const config = loadConfig(process.env);
  const store = createStore(config);
  const mcpHandler = createMcpHttpHandler(store);
  const { server, port } = await startServer(store, config.port, mcpHandler);

  const url = `http://localhost:${port}`;
  process.stdout.write(`yap listening on ${url}\n`);
  process.stdout.write(`  web UI:     ${url}/\n`);
  process.stdout.write(`  MCP:        ${url}/mcp\n`);
  process.stdout.write(`  MCP config: ${url}/mcp-config\n`);
  if (config.serverPassword) {
    process.stdout.write(`  (gated by YAP_PASSWORD)\n`);
  }

  const shutdown = (): void => {
    process.stdout.write("\nshutting down\n");
    server.closeAllConnections();
    server.close(() => process.exit(0));
    // Safety net in case close hangs.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function printMcpConfig(args: string[]): void {
  const arg = args[0];
  const url = arg ?? "http://localhost:3000";
  const blob = {
    mcpServers: {
      yap: { url: `${url.replace(/\/+$/, "")}/mcp` },
    },
  };
  process.stdout.write(JSON.stringify(blob, null, 2) + "\n");
}

function printHelp(): void {
  process.stdout.write(
    [
      "yap — a chat room for humans and agents",
      "",
      "usage:",
      "  yap [server]          start the chat server (default)",
      "  yap mcp [URL]         print a paste-ready MCP client config",
      "  yap help              show this message",
      "",
      "env:",
      "  YAP_PORT              HTTP port (default: OS-assigned)",
      "  YAP_PASSWORD          gate the whole server",
      "  YAP_BUFFER_SIZE       messages per channel (default: 200)",
      "  YAP_INACTIVE_AFTER    presence inactive threshold in seconds (default: 3600)",
      "  YAP_EVICT_AFTER       presence evict threshold in seconds (default: 43200)",
      "  YAP_RATE_LIMIT        messages per minute per nick (default: 30)",
      "",
    ].join("\n"),
  );
}
