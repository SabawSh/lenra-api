import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildDashboardMainPayload } from "@/services/pages/dashboardMain";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await buildDashboardMainPayload(user.id);
  return NextResponse.json({
    dailyGoalMinutes: user.dailyGoalMinutes,
    displayName: user.username ?? user.name ?? null,
    ...payload,
  });
}
