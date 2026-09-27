import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import * as videoQueries from "@/lib/db/queries/videos";
import { isContentIdParam } from "@/lib/ids/contentId";
import { loadMovieLearningSidebar } from "@/lib/learning/loadMovieLearningSidebar";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  props: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await props.params;
  if (!isContentIdParam(videoId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const [movie, user] = await Promise.all([
    videoQueries.fetchVideoScalarsById(videoId),
    getCurrentUser(),
  ]);

  if (
    !movie ||
    (movie.type !== "movie" && movie.type !== "documentary")
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sidebar = await loadMovieLearningSidebar({
    userId: user?.id ?? null,
    videoId,
    currentBatch: null,
    continueClipIndex: 1,
    coverUrl: movie.coverUrl,
  });

  return NextResponse.json({ sidebar });
}
