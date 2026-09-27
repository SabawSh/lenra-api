import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { upsertPushSubscription } from "@/lib/db/pushSubscriptions";
import { setPushEnabled } from "@/lib/db/notificationSettings";
import type { PushSubscribeBody } from "@/lib/push/types";
import { isWebPushConfigured } from "@/lib/push/server/vapid";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

function parseBody(body: unknown): PushSubscribeBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
  const p256dh = typeof b.p256dh === "string" ? b.p256dh.trim() : "";
  const auth = typeof b.auth === "string" ? b.auth.trim() : "";
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    p256dh,
    auth,
    platform: typeof b.platform === "string" ? b.platform : undefined,
  };
}

export async function POST(req: Request) {
  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { error: "Push notifications are not configured" },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseBody(await req.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const h = await headers();
  const userAgent = h.get("user-agent");

  try {
    const row = await upsertPushSubscription({
      userId: user.id,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      platform: parsed.platform ?? null,
      userAgent,
    });

    await setPushEnabled(user.id, true);

    return NextResponse.json({
      subscription: {
        id: row.id,
        endpoint: row.endpoint,
        platform: row.platform,
      },
    });
  } catch (e: unknown) {
    const err = e as { code?: string; errno?: number };
    if (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146) {
      return NextResponse.json(
        { error: "push_tables_missing", message: "Run: npm run db:migrate:push" },
        { status: 503 },
      );
    }
    console.error("[push subscribe]", e);
    return NextResponse.json({ error: "subscribe_failed" }, { status: 500 });
  }
}
