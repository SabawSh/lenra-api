import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildDashboardProgressPayload } from "@/services/pages/dashboardProgress";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ guest: true as const });
  }
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale")?.trim() || "fa";
  const data = await buildDashboardProgressPayload(user.id, locale);
  return NextResponse.json({ guest: false as const, ...data });
}
