import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsForUser,
} from "@/lib/db/pushSubscriptions";
import { setPushEnabled } from "@/lib/db/notificationSettings";
import { NextResponse } from "next/server";

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  const endpoint =
    typeof body.endpoint === "string" ? body.endpoint.trim() : "";

  if (endpoint) {
    await deletePushSubscriptionByEndpoint(endpoint, user.id);
  } else {
    const subs = await listPushSubscriptionsForUser(user.id);
    await Promise.all(
      subs.map((s) => deletePushSubscriptionByEndpoint(s.endpoint, user.id)),
    );
  }

  const remaining = await listPushSubscriptionsForUser(user.id);
  if (remaining.length === 0) {
    await setPushEnabled(user.id, false);
  }

  return NextResponse.json({ ok: true });
}
