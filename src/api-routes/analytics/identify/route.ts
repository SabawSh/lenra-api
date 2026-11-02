import { NextResponse } from "next/server";
import { identifyVisitorToUser } from "@/lib/analytics/ingest";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/analytics/rateLimit";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ip = clientIpFromRequest(req);
  const limit = consumeRateLimit(`analytics:identify:${ip}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const visitorId = typeof record.visitorId === "string" ? record.visitorId : "";
  const sessionId =
    typeof record.sessionId === "string" ? record.sessionId : undefined;

  if (!visitorId) {
    return NextResponse.json({ error: "missing_visitor" }, { status: 400 });
  }

  try {
    await identifyVisitorToUser({
      visitorId,
      sessionId,
      userId: user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "identify_failed";
    if (message === "invalid_ids") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.warn("[analytics/identify]", err);
    return NextResponse.json({ error: "identify_failed" }, { status: 500 });
  }
}
