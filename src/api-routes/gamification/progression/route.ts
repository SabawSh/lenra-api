import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getGamificationProgress } from "@/lib/gamification/xp";
import { getUserXpSummary } from "@/lib/db/userXp";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await getUserXpSummary(user.id);
  const progression = getGamificationProgress(summary.totalXp);

  return NextResponse.json({
    progression,
    dailyXp: summary.dailyXp,
  });
}
