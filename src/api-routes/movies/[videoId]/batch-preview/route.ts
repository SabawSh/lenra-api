import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import {
  countPartsForVideo,
} from "@/lib/db/sectionProgress";
import * as videoQueries from "@/lib/db/queries/videos";
import { isContentIdParam } from "@/lib/ids/contentId";
import { loadMovieLearningBatchPreview } from "@/lib/learning/loadMovieLearningBatchPreview";
import { buildMovieSectionPlayHref } from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { NextRequest, NextResponse } from "next/server";

/**
 * Clip-list preview for one batch. Does not rebuild the unlock catalog —
 * that was the multi-second cost when selecting a batch.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await props.params;
  const sectionIndex = Number(req.nextUrl.searchParams.get("sectionIndex") ?? "1");

  if (!isContentIdParam(videoId) || !Number.isFinite(sectionIndex) || sectionIndex < 1) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const [movie, totalParts, user] = await Promise.all([
    videoQueries.fetchVideoScalarsById(videoId),
    countPartsForVideo(videoId),
    getCurrentUser(),
  ]);

  if (
    !movie ||
    (movie.type !== "movie" && movie.type !== "documentary") ||
    totalParts < 1
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const maxSection = Math.max(
    1,
    Math.ceil(totalParts / VISIBLE_UNITS_PER_SECTION),
  );
  if (sectionIndex > maxSection) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const learnType = movie.type === "documentary" ? "documentary" : "movie";
  const remaining = Math.max(
    0,
    totalParts - (sectionIndex - 1) * VISIBLE_UNITS_PER_SECTION,
  );
  const clipCount = Math.min(VISIBLE_UNITS_PER_SECTION, remaining);

  const batch = {
    sectionIndex,
    clipCount,
    unlocked: true,
    startPart: 1,
    playHref: buildMovieSectionPlayHref(
      true,
      learnType,
      videoId,
      sectionIndex,
      1,
    ),
    firstClipUrl: null as null,
  };

  const adaptiveUser =
    user != null
      ? { id: user.id, englishLevel: user.englishLevel ?? null }
      : null;

  const preview = await loadMovieLearningBatchPreview({
    videoId,
    learnType,
    userId: user?.id ?? null,
    adaptiveUser,
    totalParts,
    currentBatch: batch,
    difficultyMix: null,
    video: movie,
  });

  const displayClipCount = Math.max(
    preview.totalCount,
    preview.clips.length,
    batch.clipCount,
  );
  const previewWithBatch = {
    ...preview,
    currentBatch: preview.currentBatch
      ? { ...preview.currentBatch, clipCount: displayClipCount }
      : { ...batch, clipCount: displayClipCount },
  };

  return NextResponse.json({ preview: previewWithBatch });
}
