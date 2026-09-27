import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getLearningResumePosition } from "@/lib/db/learningResume";
import { getStandaloneVideoMeta } from "@/lib/db/parts";
import {
  countPartsForVideo,
  getVideoSectionUnlockRows,
} from "@/lib/db/sectionProgress";
import { isContentIdParam } from "@/lib/ids/contentId";
import { enrichBatchesWithPartProgress } from "@/lib/learning/enrichBatchesWithPartProgress";
import { finalizeLearningBatchPage } from "@/lib/learning/finalizeLearningBatchPage";
import { estimatedSectionCountFromParts } from "@/lib/learning/episodeSectionsShell";
import { parseSectionsPageQuery } from "@/lib/learning/episodeSectionsPageQuery";
import {
  buildMovieSectionPlayHref,
  resolveSectionStartStep,
} from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await props.params;
  const { startSectionIndex, sectionLimit } = parseSectionsPageQuery(
    req.nextUrl.searchParams,
  );

  if (!isContentIdParam(videoId)) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const [movieMeta, totalParts, user] = await Promise.all([
    getStandaloneVideoMeta(videoId),
    countPartsForVideo(videoId),
    getCurrentUser(),
  ]);

  if (!movieMeta || totalParts < 1) {
    return NextResponse.json(
      { error: "Movie has no clips" },
      { status: 404 },
    );
  }

  const learnType = movieMeta.type === "documentary" ? "documentary" : "movie";

  const resumePosition =
    user != null && startSectionIndex === 1
      ? await getLearningResumePosition({
          userId: user.id,
          videoId,
        })
      : null;

  const { rows, hasMoreSections } = await getVideoSectionUnlockRows({
    userId: user?.id ?? null,
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
      playHref: buildMovieSectionPlayHref(
        r.unlocked,
        learnType,
        videoId,
        r.sectionIndex,
        startPart,
      ),
      firstClipUrl: null as null,
    };
  });

  const enriched = await enrichBatchesWithPartProgress({
    userId: user?.id ?? null,
    videoId,
    totalParts,
    adaptiveUser,
    batches: shell,
  });

  const sections = await finalizeLearningBatchPage({
    enriched,
    userId: user?.id ?? null,
    videoId,
    totalParts,
    adaptiveUser,
    buildPlayHref: (row, step) =>
      buildMovieSectionPlayHref(
        true,
        learnType,
        videoId,
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
