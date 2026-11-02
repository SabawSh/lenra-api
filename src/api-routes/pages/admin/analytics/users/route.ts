import { NextResponse } from "next/server";
import { getAnalyticsUserExplorer } from "@/lib/analytics/adminQueries";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const registered = url.searchParams.get("registered");
  const data = await getAnalyticsUserExplorer({
    q: url.searchParams.get("q") ?? undefined,
    channel: url.searchParams.get("channel") ?? undefined,
    registered:
      registered === "yes" || registered === "no" || registered === "any"
        ? registered
        : "any",
    device: url.searchParams.get("device") ?? undefined,
    from: url.searchParams.get("from")
      ? new Date(url.searchParams.get("from")!)
      : undefined,
    to: url.searchParams.get("to")
      ? new Date(url.searchParams.get("to")!)
      : undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
    offset: Number(url.searchParams.get("offset") ?? 0),
  });
  return NextResponse.json(data);
}
