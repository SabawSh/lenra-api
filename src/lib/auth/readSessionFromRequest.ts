import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type SessionPayload,
} from "./session";

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    out[name] = decodeURIComponent(rest.join("=").trim());
  }
  return out;
}

export async function readSessionFromRequest(
  request: Request,
): Promise<SessionPayload | null> {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const token = parseCookieHeader(header)[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}
