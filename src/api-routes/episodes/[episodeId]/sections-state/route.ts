import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getLearningResumePosition } from "@/lib/db/learningResume";
import {
  countPartsForEpisode,
  getEpisodeSectionUnlockRows,
} from "@/lib/db/sectionProgress";
import { isContentIdParam } from "@/lib/ids/contentId";
import { enrichBatchesWithPartProgress } from "@/lib/learning/enrichBatchesWithPartProgress";
import { finalizeLearningBatchPage } from "@/lib/learning/finalizeLearningBatchPage";
import { estimatedSectionCountFromParts } from "@/lib/learning/episodeSectionsShell";
import { parseSectionsPageQuery } from "@/lib/learning/episodeSectionsPageQuery";
import {
  buildSectionPlayHref,
  resolveSectionStartStep,
} from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const seasonId = searchParams.get("seasonId");
  const { startSectionIndex, sectionLimit } = parseSectionsPageQuery(searchParams);

  if (
    !isContentIdParam(episodeId) ||
    typeof videoId !== "string" ||
    typeof seasonId !== "string" ||
    !isContentIdParam(videoId) ||
    !isContentIdParam(seasonId)
  ) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const totalParts = await countPartsForEpisode(episodeId);
  if (totalParts < 1) {
    return NextResponse.json(
      { error: "Episode has no clips" },
      { status: 404 },
    );
  }

  const user = await getCurrentUser();
  const resumePosition =
    user != null && startSectionIndex === 1
      ? await getLearningResumePosition({
          userId: user.id,
          videoId,
          episodeId,
        })
      : null;

  const { rows, hasMoreSections } = await getEpisodeSectionUnlockRows({
    userId: user?.id ?? null,
    episodeId,
    videoId,
    totalParts,
    startSectionIndex,
    sectionLimit,
  });

  const adaptiveUser =
    user != null
      ? { id: user.id, englishLevel: user.englishLevel ?? null }
      : null;

  const shell = rows.map((r) => {
    const startPart = resolveSectionStartStep(
      r.sectionIndex,
      VISIBLE_UNITS_PER_SECTION,
      resumePosition,
    );
    return {
      sectionIndex: r.sectionIndex,
      clipCount: VISIBLE_UNITS_PER_SECTION,
      unlocked: r.unlocked,
      startPart,
      playHref: buildSectionPlayHref(
        r.unlocked,
        videoId,
        seasonId,
        episodeId,
        r.sectionIndex,
        startPart,
      ),
      firstClipUrl: null as string | null,
    };
  });

  const enriched = await enrichBatchesWithPartProgress({
    userId: user?.id ?? null,
    videoId,
    episodeId,
    totalParts,
    adaptiveUser,
    batches: shell,
  });

  const sections = await finalizeLearningBatchPage({
    enriched,
    userId: user?.id ?? null,
    videoId,
    episodeId,
    totalParts,
    adaptiveUser,
    buildPlayHref: (row, step) =>
      buildSectionPlayHref(
        true,
        videoId,
        seasonId,
        episodeId,
        row.sectionIndex,
        step,
      ),
  });

  return NextResponse.json({
    sections,
    hasMoreSections,
    totalParts,
    estimatedSectionCount: estimatedSectionCountFromParts(totalParts),
    userLastPosition: resumePosition,
  });
}
