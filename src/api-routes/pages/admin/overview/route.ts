import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { getAdminOverviewData } from "@/lib/db/queries/adminOverview";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getAdminOverviewData();
  return NextResponse.json(JSON.parse(JSON.stringify(data)));
}
