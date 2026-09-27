import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import * as videoQueries from "@/lib/db/queries/videos";
import { isContentIdParam } from "@/lib/ids/contentId";
import { loadMovieLearningSidebar } from "@/lib/learning/loadMovieLearningSidebar";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  const videoId = req.nextUrl.searchParams.get("videoId");

  if (
    !isContentIdParam(episodeId) ||
    typeof videoId !== "string" ||
    !isContentIdParam(videoId)
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const [episode, series, user] = await Promise.all([
    videoQueries.fetchEpisodeById(episodeId),
    videoQueries.fetchVideoScalarsById(videoId),
    getCurrentUser(),
  ]);

  if (!episode || !series || series.type !== "series") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sidebar = await loadMovieLearningSidebar({
    userId: user?.id ?? null,
    videoId,
    episodeId,
    currentBatch: null,
    continueClipIndex: 1,
    coverUrl: episode.coverUrl || series.coverUrl,
  });

  return NextResponse.json({ sidebar });
}
