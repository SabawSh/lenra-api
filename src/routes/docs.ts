import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { getPublicBaseUrl } from "../config/env.js";
import { openApiSpecForServer } from "../openapi/spec.js";

export const docsRoutes = new Hono();

docsRoutes.get("/api/openapi", (c) => {
  const spec = openApiSpecForServer(getPublicBaseUrl(c.req.raw));
  return c.json(spec, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

docsRoutes.get(
  "/docs",
  swaggerUI({
    url: "/api/openapi",
  }),
);

docsRoutes.get("/docs/", (c) => c.redirect("/docs"));
