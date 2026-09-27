function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getPort(): number {
  const raw = process.env.PORT?.trim() ?? "4000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }
  return port;
}

export function getDatabaseUrl(): string {
  return required("DATABASE_URL");
}

export function getAuthSecret(): string | null {
  const raw = process.env.AUTH_SECRET?.trim();
  return raw || null;
}

export function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function getInternalApiSecret(): string | null {
  const raw = process.env.API_INTERNAL_SECRET?.trim();
  return raw || null;
}

/** Public URL of this API (for OpenAPI servers block). */
export function getPublicBaseUrl(req?: Request): string {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (req) {
    const url = new URL(req.url);
    return url.origin;
  }

  const port = getPort();
  return `http://127.0.0.1:${port}`;
}
