import { NextResponse } from "next/server";
import {
  getDefaultUserAchievements,
  getUserAchievements,
} from "@/lib/db/achievements";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const achievements = await getUserAchievements(user.id, {
    skipSync: true,
  }).catch(() => getDefaultUserAchievements());

  return NextResponse.json({ achievements });
}
