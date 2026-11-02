import { NextResponse } from "next/server";
import { ingestAnalyticsBatch } from "@/lib/analytics/ingest";
import {
  ANALYTICS_MAX_BATCH,
} from "@/lib/analytics/eventCatalog";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/analytics/rateLimit";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIpFromRequest(req);
  const limit = consumeRateLimit(`analytics:collect:${ip}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  if (record.consent !== "granted") {
    return NextResponse.json({ error: "consent_required" }, { status: 403 });
  }

  const visitorId = typeof record.visitorId === "string" ? record.visitorId : "";
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
  const events = Array.isArray(record.events) ? record.events : [];

  if (!visitorId || !sessionId || events.length === 0) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (events.length > ANALYTICS_MAX_BATCH) {
    return NextResponse.json({ error: "batch_too_large" }, { status: 413 });
  }

  const user = await getCurrentUser().catch(() => null);

  try {
    const result = await ingestAnalyticsBatch({
      visitorId,
      sessionId,
      userId: user?.id ?? null,
      context:
        record.context && typeof record.context === "object"
          ? (record.context as never)
          : undefined,
      events: events.map((event) => {
        const e = event as Record<string, unknown>;
        return {
          eventId: String(e.eventId ?? ""),
          name: String(e.name ?? ""),
          path: typeof e.path === "string" ? e.path : undefined,
          properties:
            e.properties && typeof e.properties === "object"
              ? (e.properties as Record<string, unknown>)
              : undefined,
          clientTs: typeof e.clientTs === "string" ? e.clientTs : undefined,
        };
      }),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest_failed";
    if (message === "invalid_ids") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.warn("[analytics/collect]", err);
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
