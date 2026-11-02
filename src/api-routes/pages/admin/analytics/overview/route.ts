import { NextResponse } from "next/server";
import {
  getAnalyticsOverview,
  resolveAnalyticsRange,
} from "@/lib/analytics/adminQueries";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const range = resolveAnalyticsRange(
    url.searchParams.get("preset"),
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const data = await getAnalyticsOverview(range);
  return NextResponse.json(data);
}
