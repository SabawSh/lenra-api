
type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  const { message: _metaMsg, ...rest } = meta ?? {};
  const payload = meta ? { message, ...rest, ...(meta.message ? { detail: meta.message } : {}) } : { message };
  if (level === "error") {
    console.error("[push]", payload);
  } else if (level === "warn") {
    console.warn("[push]", payload);
  } else if (
    process.env.PUSH_DEBUG === "1" ||
    process.env.NODE_ENV === "development"
  ) {
    console.info("[push]", payload);
  }
}

export const pushLog = {
  info: (message: string, meta?: Record<string, unknown>) =>
    log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    log("error", message, meta),
};
