import { NextRequest } from "next/server";

/** Build NextRequest from Hono/node fetch Request (NextRequest cannot wrap it directly). */
export function toNextRequest(raw: Request): NextRequest {
  if (raw instanceof NextRequest) {
    return raw;
  }

  const init: RequestInit = {
    method: raw.method,
    headers: raw.headers,
    redirect: raw.redirect,
    signal: raw.signal,
  };

  if (raw.body) {
    init.body = raw.body;
    init.duplex = "half";
  }

  return new NextRequest(raw.url, init);
}
