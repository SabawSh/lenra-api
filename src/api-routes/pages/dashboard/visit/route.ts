import { NextResponse } from "next/server";
import { runDashboardVisitForRequest } from "@/services/pages/dashboardVisit";

export const runtime = "nodejs";

export async function POST() {
  const result = await runDashboardVisitForRequest();
  if (!result.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
