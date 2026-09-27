import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { countPartsForEpisode } from "@/lib/db/sectionProgress";
import * as videoQueries from "@/lib/db/queries/videos";
import { isContentIdParam } from "@/lib/ids/contentId";
import { loadMovieLearningBatchPreview } from "@/lib/learning/loadMovieLearningBatchPreview";
import { buildSectionPlayHref } from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { NextRequest, NextResponse } from "next/server";

/**
 * Clip-list preview for one episode batch. Skips unlock-catalog rebuild.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  const videoId = req.nextUrl.searchParams.get("videoId");
  const seasonId = req.nextUrl.searchParams.get("seasonId");
  const sectionIndex = Number(
    req.nextUrl.searchParams.get("sectionIndex") ?? "1",
  );

  if (
    !isContentIdParam(episodeId) ||
    typeof videoId !== "string" ||
    typeof seasonId !== "string" ||
    !isContentIdParam(videoId) ||
    !isContentIdParam(seasonId) ||
    !Number.isFinite(sectionIndex) ||
    sectionIndex < 1
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const [episode, series, seasonShell, totalParts, user] = await Promise.all([
    videoQueries.fetchEpisodeById(episodeId),
    videoQueries.fetchVideoScalarsById(videoId),
    videoQueries.fetchVideoSeasonShellLearn(videoId, seasonId),
    countPartsForEpisode(episodeId),
    getCurrentUser(),
  ]);

  if (
    !episode ||
    episode.seasonId !== seasonId ||
    !series ||
    series.type !== "series" ||
    !seasonShell ||
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
    playHref: buildSectionPlayHref(
      true,
      videoId,
      seasonId,
      episodeId,
      sectionIndex,
      1,
    ),
    firstClipUrl: null as null,
  };

  const adaptiveUser =
    user != null
      ? { id: user.id, englishLevel: user.englishLevel ?? null }
      : null;

  const episodeTitle = episode.title?.trim() || series.name;
  const coverUrl = episode.coverUrl || series.coverUrl;

  const preview = await loadMovieLearningBatchPreview({
    videoId,
    series: { seasonId, episodeId },
    userId: user?.id ?? null,
    adaptiveUser,
    totalParts,
    currentBatch: batch,
    difficultyMix: null,
    video: {
      name: episodeTitle,
      coverUrl,
      levels: series.levels,
      releaseAt: episode.releaseAt,
      durationMs: episode.durationMs,
      description: episode.description?.trim() || series.description,
    },
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
