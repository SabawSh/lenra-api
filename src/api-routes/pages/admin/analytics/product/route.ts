import { NextResponse } from "next/server";
import { resolveAnalyticsRange } from "@/lib/analytics/adminQueries";
import {
  getActivationFunnel,
  getOrganicAcquisitionFunnel,
  getProductAnalyticsOverview,
  getRetentionCohorts,
} from "@/lib/analytics/productQueries";
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
  const [overview, funnel, retention, organic] = await Promise.all([
    getProductAnalyticsOverview(range),
    getActivationFunnel(range),
    getRetentionCohorts({ weeks: 8 }),
    getOrganicAcquisitionFunnel(range),
  ]);
  return NextResponse.json({ overview, funnel, retention, organic });
}
