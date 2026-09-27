import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildHomeSidebarStats } from "@/services/pages/homeSidebarStats";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await buildHomeSidebarStats(user.id);
  return NextResponse.json(data);
}
