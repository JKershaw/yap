import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

export type Router = {
  routes: Map<string, RouteHandler>;
  fallback?: RouteHandler;
};

export function createRouter(): Router {
  return { routes: new Map() };
}

export function addRoute(
  router: Router,
  method: string,
  path: string,
  handler: RouteHandler,
): void {
  router.routes.set(`${method.toUpperCase()} ${path}`, handler);
}

export function setFallback(router: Router, handler: RouteHandler): void {
  router.fallback = handler;
}

export async function handle(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const handler = router.routes.get(`${method} ${pathname}`);
  if (handler) {
    await handler(req, res);
    return;
  }
  if (router.fallback) {
    await router.fallback(req, res);
    return;
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "not found" }));
}
