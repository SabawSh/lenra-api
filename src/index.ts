import "./bootstrap.js";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { AppEnv } from "./types.js";
import { getPort } from "./config/env.js";
import { closeDbPool } from "@/lib/db/connection.js";
import { corsMiddleware } from "./middleware/cors.js";
import { docsRoutes } from "./routes/docs.js";
import { healthRoutes } from "./routes/health.js";
import { lenraApiDispatch } from "./routes/lenra/dispatch.js";

const app = new Hono<AppEnv>();

app.use("*", corsMiddleware);

app.route("/", healthRoutes);
app.route("/", docsRoutes);
app.route("/", lenraApiDispatch);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

const port = getPort();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`lenra-api listening on http://127.0.0.1:${info.port}`);
  console.log(`  GET /health`);
  console.log(`  GET /ready`);
  console.log(`  GET /docs — Swagger UI`);
  console.log(`  GET /api/openapi`);
  console.log(`  ALL /api/* — Lenra handlers`);
});

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await closeDbPool();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  });
}
