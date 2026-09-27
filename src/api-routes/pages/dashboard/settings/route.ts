import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { asStringArray } from "@/lib/db/jsonStringArray";
import { getUserXpSummary } from "@/lib/db/userXp";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const progression = await getUserXpSummary(user.id).catch(() => ({
    dailyXp: 0,
    totalXp: 0,
    level: 1,
    progressPercent: 0,
    xpIntoLevel: 0,
    xpForNextLevel: 100,
    xpRemainingToNextLevel: 100,
  }));
  return NextResponse.json(
    JSON.parse(
      JSON.stringify({
        user: {
          ...user,
          contentPrefs: asStringArray(user.contentPrefs),
        },
        progression,
      }),
    ),
  );
}
