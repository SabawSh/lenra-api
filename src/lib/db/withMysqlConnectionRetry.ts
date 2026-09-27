function isRetryableMysqlConnection(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as NodeJS.ErrnoException & { code?: string };
  const code = err.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "PROTOCOL_ENQUEUE_AFTER_QUIT" ||
    code === "EPIPE"
  );
}

/** Retries transient mysql2 / pool disconnect errors. */
export async function withMysqlConnectionRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      last = err;
      if (!isRetryableMysqlConnection(e) || i === attempts - 1) {
        throw err;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 400 * 2 ** i));
    }
  }
  throw last ?? new Error("Retry exhausted");
}
