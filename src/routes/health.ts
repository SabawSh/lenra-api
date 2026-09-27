import { Hono } from "hono";
import { pool } from "@/lib/db/connection.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) =>
  c.json({ ok: true, service: "lenra-api" }),
);

healthRoutes.get("/ready", async (c) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query("SELECT 1");
    } finally {
      conn.release();
    }
    return c.json({ ok: true, db: true });
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});
