/**
 * MySQL pool for content sync/import.
 * Must NOT import `@/lib/db/connection` (that module uses `server-only`).
 *
 * In Next.js Admin requests the pool must stay open across concurrent handlers.
 * Only CLI scripts should call closeContentSyncPool() on process exit.
 */
import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

let syncPool: Pool | null = null;
let syncPoolClosed = false;

export function getContentSyncPool(): Pool {
  if (syncPool && !syncPoolClosed) return syncPool;

  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error("DATABASE_URL is not set");
  }

  syncPool = mysql.createPool({
    uri,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });
  syncPoolClosed = false;
  return syncPool;
}

export async function closeContentSyncPool(): Promise<void> {
  if (!syncPool || syncPoolClosed) {
    syncPool = null;
    syncPoolClosed = true;
    return;
  }
  const pool = syncPool;
  syncPool = null;
  syncPoolClosed = true;
  await pool.end();
}
