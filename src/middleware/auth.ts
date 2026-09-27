import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/**
 * Placeholder auth — wire to the same JWT/session format as Lenra (`lib/auth/sessionCookie.ts`)
 * when you move routes here. Until then, routes can stay on Next.js or use internal secret.
 */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("userId", null);
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
