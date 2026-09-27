import { Hono } from "hono";
import { runWithApiRequest } from "@/lib/auth/apiRequestContext.js";
import { toNextRequest } from "./toNextRequest.js";
import type { AppEnv } from "../../types.js";
import { compileRoutes, matchLenraRoute } from "./match.js";
import { lenraRoutes, type LenraRouteHandler } from "./registry.generated.js";

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

compileRoutes(lenraRoutes);

const moduleCache = new Map<
  string,
  Record<string, LenraRouteHandler | undefined>
>();

function pickRouteHandlers(
  mod: Record<string, unknown>,
): Record<string, LenraRouteHandler | undefined> {
  const handlers: Record<string, LenraRouteHandler | undefined> = {};
  for (const [key, value] of Object.entries(mod)) {
    if (HTTP_METHODS.has(key) && typeof value === "function") {
      handlers[key] = value as LenraRouteHandler;
    }
  }
  return handlers;
}

async function loadHandlers(
  entry: (typeof lenraRoutes)[number],
): Promise<Record<string, LenraRouteHandler | undefined>> {
  const key = entry.urlPattern;
  const cached = moduleCache.get(key);
  if (cached) return cached;
  const mod = await entry.load();
  const handlers = pickRouteHandlers(mod);
  moduleCache.set(key, handlers);
  return handlers;
}

export const lenraApiDispatch = new Hono<AppEnv>();

/** Hono `/api/*` only matches one path segment; use a global handler instead. */
lenraApiDispatch.all("*", async (c) => {
  const url = new URL(c.req.url);
  if (!url.pathname.startsWith("/api/")) {
    return c.notFound();
  }
  const matched = matchLenraRoute(url.pathname);
  if (!matched) {
    return c.json({ error: "not_found", path: url.pathname }, 404);
  }

  const method = c.req.method.toUpperCase();
  if (!HTTP_METHODS.has(method)) {
    return c.json({ error: "method_not_allowed" }, 405);
  }

  const handlers = await loadHandlers(matched.entry);
  const handler = handlers[method as keyof typeof handlers];
  if (!handler) {
    return c.json({ error: "method_not_allowed" }, 405);
  }

  try {
    const response = await runWithApiRequest(c.req.raw, async () => {
      const ctx = {
        params: Promise.resolve(
          matched.params as Record<string, string | string[]>,
        ),
      };
      return handler(toNextRequest(c.req.raw), ctx);
    });
    return response;
  } catch (error) {
    console.error("[lenra-api] route error", url.pathname, error);
    return c.json({ error: "internal_error" }, 500);
  }
});
