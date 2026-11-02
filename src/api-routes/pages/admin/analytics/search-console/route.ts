import { NextResponse } from "next/server";
import { fetchSearchConsoleStatus } from "@/lib/analytics/searchConsole";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

export const runtime = "nodejs";

/**
 * Live Google Search Console status + metrics.
 * Never fabricates SEO numbers — metrics are null when the API call fails.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const startDate = url.searchParams.get("from");
  const endDate = url.searchParams.get("to");

  const data = await fetchSearchConsoleStatus({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  return NextResponse.json({
    provider: "google_search_console",
    ...data,
  });
}
