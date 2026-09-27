import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import {
  getNotificationSettings,
  upsertNotificationSettings,
} from "@/lib/db/notificationSettings";
import { countPushSubscriptionsForUser } from "@/lib/db/pushSubscriptions";
import type { NotificationSettingsUpdate } from "@/lib/push/types";
import { NextResponse } from "next/server";

function parsePatch(body: unknown): NotificationSettingsUpdate | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const patch: NotificationSettingsUpdate = {};
  if (typeof b.pushEnabled === "boolean") patch.pushEnabled = b.pushEnabled;
  if (typeof b.reviewReminders === "boolean") {
    patch.reviewReminders = b.reviewReminders;
  }
  if (typeof b.streakReminders === "boolean") {
    patch.streakReminders = b.streakReminders;
  }
  if (typeof b.marketing === "boolean") patch.marketing = b.marketing;
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getNotificationSettings(user.id);
  const hasSubscription =
    (await countPushSubscriptionsForUser(user.id)) > 0;
  return NextResponse.json({ settings, hasSubscription });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const patch = parsePatch(await req.json().catch(() => null));
  if (!patch) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  const settings = await upsertNotificationSettings(user.id, patch);
  const hasSubscription =
    (await countPushSubscriptionsForUser(user.id)) > 0;
  return NextResponse.json({ settings, hasSubscription });
}
