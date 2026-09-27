import type { MiddlewareHandler } from "hono";
import { getCorsOrigins } from "../config/env.js";

export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = getCorsOrigins();

  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Lenra-Internal-Secret",
    );
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
};
