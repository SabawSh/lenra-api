import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getUserLastSeenForSeason } from "@/lib/db/lastSeen";
import { isContentIdParam } from "@/lib/ids/contentId";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const seasonId = searchParams.get("seasonId");

  if (
    typeof videoId !== "string" ||
    typeof seasonId !== "string" ||
    !isContentIdParam(videoId) ||
    !isContentIdParam(seasonId)
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ episodeId: null, order: 1 });
  }

  const lastSeen = await getUserLastSeenForSeason(user.id, videoId, seasonId);

  return NextResponse.json({
    episodeId: lastSeen?.episodeId ?? null,
    order: lastSeen?.order ?? 1,
  });
}
