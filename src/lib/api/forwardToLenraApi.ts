import { NextRequest, NextResponse } from "next/server";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "host",
]);

function lenraApiBase(): string | null {
  const raw = process.env.LENRA_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** Forward /api/* to lenra-api when LENRA_API_URL is configured. */
export async function forwardToLenraApi(
  req: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const base = lenraApiBase();
  if (!base) {
    return NextResponse.json(
      { error: "LENRA_API_URL is not configured" },
      { status: 503 },
    );
  }

  const path = pathSegments.filter(Boolean).join("/");
  const target = new URL(`/api/${path}`, base);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
