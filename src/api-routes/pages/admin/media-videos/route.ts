import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getVideos } from "@/lib/db/videos";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isSiteAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const videos = await getVideos();
  return NextResponse.json({ videos });
}
