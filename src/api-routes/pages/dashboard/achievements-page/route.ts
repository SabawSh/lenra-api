import { NextResponse } from "next/server";
import { getAchievementsPageData } from "@/lib/achievements/getPageData";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await getAchievementsPageData(user.id, { skipSync: true });
  return NextResponse.json(JSON.parse(JSON.stringify(data)));
}
