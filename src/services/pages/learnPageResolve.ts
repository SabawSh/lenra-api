import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";
import type { LearningSessionStats } from "@/lib/db/learningSessionStats";
import type { SectionDisplaySlot } from "@/lib/learning/buildSectionDisplaySession";
import type { SectionSummaryStats } from "@/lib/learning/sectionSummaryStats";
import { getVideoSeasonShellForLearn } from "@/lib/database";
import { getLearningSessionStats } from "@/lib/db/learningSessionStats";
import {
  getEpisodePartsOrderMeta,
  getVideoPartsOrderMeta,
} from "@/lib/db/parts";
import * as videoQueries from "@/lib/db/queries/videos";
import {
  countPartsForEpisode,
} from "@/lib/db/sectionProgress";
import { isContentIdParam } from "@/lib/ids/contentId";
import { getAdaptiveEpisodeOrder } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  loadSectionSummaryPageData,
  loadSeriesSummaryTitle,
} from "@/lib/learning/loadSectionSummaryPage";
import {
  countVisibleSections,
  getOrMaterializeProgressionSection,
  hydrateVisibleSectionUnits,
} from "@/lib/learning/sectionCurriculum";
import { resolveLearnDisplaySession } from "@/lib/learning/resolveLearnDisplaySession";
import type { LearnDisplaySessionResult } from "@/lib/learning/resolveLearnDisplaySession";
import { resolveLearnPlayerStart } from "@/lib/learning/resolveLearnPlayerStart";
import { countComposedDisplaySlotKinds } from "@/lib/learning/sectionDisplaySessionState";
import { bookmarkOrderForVisibleStep } from "@/lib/learning/sectionResume";
import {
  sectionIndexFromOrder,
  VISIBLE_UNITS_PER_SECTION,
} from "@/lib/learning/sections";
import {
  parseContentDifficultyFilter,
  partMatchesContentDifficultyFilter,
} from "@/lib/learning/videoDifficultyMix";
import { getTranslations } from "next-intl/server";
import {
  flattenLearningUnitPartIds,
  logSectionTransition,
} from "@/lib/debug/sectionTransitionTrace";
import type { LearningUnit } from "@/lib/skill-engine/learning-units/types";
import type { Part } from "@/types/video";

export type LearnDeferredSideEffect =
  | {
      kind: "bookmark";
      videoId: string;
      order: number;
      seasonId?: string;
      episodeId?: string;
    }
  | {
      kind: "advanceResume";
      videoId: string;
      seasonId?: string;
      episodeId?: string;
      resumeSection: number;
      resumePart: number;
      unlockAtLeast?: number;
    };

export type LearnPageResolveInput = {
  locale: string;
  type: string;
  videoId: string;
  rawParams: string[];
  searchParams: {
    order?: string;
    step?: string;
    part?: string;
    summary?: string;
    autoplay?: string;
    review?: string;
    batchReview?: string;
    contentDifficulty?: string;
  };
};

export type LearnPageResolveResult =
  | { outcome: "notFound"; source?: string; details?: Record<string, unknown> }
  | {
      outcome: "redirect";
      pathname: string;
      query?: Record<string, string>;
      locale: string;
    }
  | {
      outcome: "learningBlocked";
      pathname: string;
      locale: string;
    }
  | {
      outcome: "summary";
      deferred: LearnDeferredSideEffect[];
      props: {
        stats: SectionSummaryStats;
        sectionIndex: number;
        totalSections: number;
        contentTitle: string;
        nextSectionHref: string | null;
        exitHref: string;
        isLastSection: boolean;
      };
    }
  | {
      outcome: "player";
      deferred: LearnDeferredSideEffect[];
      props: {
        playerKey: string;
        learningUnits: unknown[];
        displaySlots?: SectionDisplaySlot[];
        composedDisplaySlots?: SectionDisplaySlot[];
        initialUnitIndex: number;
        initialAutoplay: boolean;
        videoId: string;
        type: "series" | "movie" | "documentary";
        seasonId?: string;
        episodeId?: string;
        sessionStats: LearningSessionStats;
        reviewMode: boolean;
        reviewReturnPath: string;
        sectionNav: {
          sectionIndex: number;
          totalParts: number;
          totalSections: number;
          sectionPath: string;
          exitListHref: string;
        };
      };
    };


/** Development-only breadcrumb before every Learn `notFound()`. */
function learnNotFound(
  source: string,
  details?: Record<string, unknown>,
): LearnPageResolveResult {
  console.error(
    `[LEARN_404] 404_SOURCE=${source}`,
    details ? JSON.stringify(details) : "",
  );
  return { outcome: "notFound", source, details };
}

function isSeriesSectionPath(params: string[] | undefined) {
  return (
    params &&
    params.length >= 4 &&
    params[2] === "section" &&
    !isNaN(+params[3]) &&
    +params[3] >= 1
  );
}

function redirectToSectionSummary(
  locale: string,
  sectionPath: string,
  extraQuery: Record<string, string> = {},
): LearnPageResolveResult {
  return {
    outcome: "redirect",
    pathname: sectionPath,
    query: { summary: "1", ...extraQuery },
    locale,
  };
}

function isMovieSectionPath(params: string[] | undefined) {
  return (
    params &&
    params.length >= 2 &&
    params[0] === "section" &&
    !isNaN(+params[1]) &&
    +params[1] >= 1
  );
}

function learnPlayerQueryExtras(opts: {
  initialAutoplay: boolean;
  reviewMode: boolean;
  batchReviewMode: boolean;
  contentDifficultyQuery?: Record<string, string>;
}): Record<string, string> {
  return {
    ...(opts.initialAutoplay ? { autoplay: "1" } : {}),
    ...(opts.reviewMode ? { review: "1" } : {}),
    ...(opts.batchReviewMode ? { batchReview: "1" } : {}),
    ...(opts.contentDifficultyQuery ?? {}),
  };
}

/**
 * Async RSC body — kept behind Suspense (see `page.tsx`) so navigations show
 * `LearnLessonFallback` while this tree resolves.
 */
export async function resolveLearnPage(
  input: LearnPageResolveInput,
): Promise<LearnPageResolveResult> {
  const deferred: LearnDeferredSideEffect[] = [];
  const resolvedParams = {
    locale: input.locale,
    type: input.type,
    videoId: input.videoId,
    params: input.rawParams,
  };

  const sp = input.searchParams;
  const initialAutoplay = sp.autoplay === "1";
  const reviewMode = sp.review === "1";
  const batchReviewMode = sp.batchReview === "1";
  const contentDifficultyFilter = parseContentDifficultyFilter(
    sp.contentDifficulty,
  );
  const contentDifficultyQuery: Record<string, string> =
    contentDifficultyFilter === "All"
      ? {}
      : { contentDifficulty: contentDifficultyFilter };

  const type = resolvedParams.type;
  const videoId = resolvedParams.videoId;
  const locale = resolvedParams.locale;
  const rawParams = resolvedParams.params ?? [];

  if (type === "series") {
    const seasonId = rawParams[0];
    const episodeId = rawParams[1];
    if (
      !seasonId ||
      !episodeId ||
      !isContentIdParam(videoId) ||
      !isContentIdParam(seasonId) ||
      !isContentIdParam(episodeId)
    ) {
      return { outcome: "notFound" };
    }

    const [user, videoShell, totalParts] = await Promise.all([
      getCurrentUser(),
      getVideoSeasonShellForLearn(videoId, seasonId),
      countPartsForEpisode(episodeId),
    ]);
    if (user) {
      const canAccess = await userCanAccessLearning(user);
      if (!canAccess) {
        return { outcome: "learningBlocked", pathname: "/dashboard/plans", locale };
      }
    }
    if (!videoShell) return { outcome: "notFound" };
    if (totalParts < 1) return { outcome: "notFound" };

    const legacyOrder =
      sp.order && !isNaN(+sp.order) && +sp.order >= 1 ? +sp.order : null;

    if (!isSeriesSectionPath(rawParams) && legacyOrder != null) {
      const s = sectionIndexFromOrder(legacyOrder);
      return { outcome: "redirect", pathname: `/learn/series/${videoId}/${seasonId}/${episodeId}/section/${s}`, query: { step: "1" }, locale };
    }

    if (!isSeriesSectionPath(rawParams)) {
      return { outcome: "redirect", pathname: `/learn/series/${videoId}/${seasonId}/${episodeId}/section/1`, query: { step: "1" }, locale };
    }

    const sectionIndex = +rawParams[3]!;
    const summary = sp.summary === "1";

    // Content access is unrestricted — sequential unlock is not an access gate.
    // Invalid indices are rejected via totalSections / empty playlist below.

    const sectionPath = `/learn/series/${videoId}/${seasonId}/${episodeId}/section/${sectionIndex}`;
    const exitListHref = `/series/${videoShell.id}/${seasonId}/${episodeId}/sections`;

    if (summary) {
      const [summaryData, t] = await Promise.all([
        loadSectionSummaryPageData({
          scope: { episodeId, curriculumId: `episode:${episodeId}` },
          sectionIndex,
          userId: user?.id ?? null,
          totalParts,
          episodeId,
          videoId,
        }),
        getTranslations("learningBreadcrumb"),
      ]);

      if (!summaryData.found) return { outcome: "notFound" };

      // Do NOT redirect incomplete summary → ?step=1. That restarts the section
      // after the learner finished the last clip (progress commit race). Show the
      // summary; next-section CTA is gated by the real unlock check below.

      if (
        user &&
        summaryData.sectionComplete &&
        summaryData.nextSectionUnlocked
      ) {
        deferred.push(
          {
            kind: "bookmark",
            videoId,
            order: bookmarkOrderForVisibleStep(sectionIndex + 1, 1),
            seasonId,
            episodeId,
          },
          {
            kind: "advanceResume",
            videoId,
            seasonId,
            episodeId,
            resumeSection: sectionIndex + 1,
            resumePart: 1,
            unlockAtLeast: sectionIndex + 1,
          },
        );
      }

      const contentTitle = await loadSeriesSummaryTitle(
        episodeId,
        t("episode", { num: "" }),
      );

      const nextSectionHref = summaryData.nextSectionUnlocked
        ? `/learn/series/${videoId}/${seasonId}/${episodeId}/section/${sectionIndex + 1}?step=1`
        : null;

      logSectionTransition({
        phase: "LearnPageContent.render-summary",
        requestedSectionIndex: sectionIndex,
        renderedSectionIndex: sectionIndex,
        unlocked: true,
        summary: true,
        redirectTo: nextSectionHref ?? undefined,
      });

      return {
        outcome: "summary",
        deferred,
        props: {
          stats: summaryData.stats,
          sectionIndex,
          totalSections: summaryData.totalSections,
          contentTitle,
          nextSectionHref,
          exitHref: exitListHref,
          isLastSection: summaryData.isLastSection,
        },
      };
    }

    const curriculumId = `episode:${episodeId}`;
    const curriculumParts = await getEpisodePartsOrderMeta(episodeId);

    if (curriculumParts.length === 0) return { outcome: "notFound" };

    const globalOrder = await getAdaptiveEpisodeOrder({
      episodeParts: curriculumParts,
      user,
      context: { curriculumId, totalParts },
    });

    const totalSections = await countVisibleSections(globalOrder, user);
    if (sectionIndex > totalSections) {
      return { outcome: "notFound" };
    }

    const playlist = await getOrMaterializeProgressionSection({
      progressionScope: {
        scope: { episodeId, curriculumId },
        videoId,
        episodeId,
      },
      sectionIndex,
      user,
      totalParts,
      mode: reviewMode ? "dynamic" : "get-or-create",
      options: {
        // Normal learner flow: one canonical clip per unit (see LEARNER_FORCE_ATOMIC_UNITS).
        forceAtomicUnits: true,
        sectionIndex,
        sectionId: `${curriculumId}:section:${sectionIndex}`,
      },
    });
    if (playlist.learningUnits.length === 0) return { outcome: "notFound" };

    const { learningUnits: hydratedUnits, progressionUnits } =
      await hydrateVisibleSectionUnits(playlist);
    if (hydratedUnits.length === 0) return { outcome: "notFound" };

    let learningUnits: LearningUnit<Part>[] = hydratedUnits;
    let displaySlots: SectionDisplaySlot[] | undefined;
    let composedDisplaySlots: SectionDisplaySlot[] | undefined;
    const displaySession: LearnDisplaySessionResult | null =
      await resolveLearnDisplaySession({
      userId: user?.id ?? null,
      videoId,
      episodeId,
      sectionIndex,
      globalOrder,
      user,
      reviewMode,
      batchReviewMode,
      buildOptions: {
        forceAtomicUnits: true,
        sectionIndex,
        sectionId: `${curriculumId}:section:${sectionIndex}`,
      },
      progressionUnits,
    });
    if (displaySession) {
      displaySlots = displaySession.displaySlots;
      composedDisplaySlots = displaySession.composedDisplaySlots;
      learningUnits = displaySession.learningUnits;
      if (learningUnits.length === 0) {
        const kinds = countComposedDisplaySlotKinds(
          displaySession.composedDisplaySlots,
        );
        if (
          kinds.total > 0 &&
          kinds.playable === 0 &&
          !reviewMode &&
          !batchReviewMode
        ) {
          return redirectToSectionSummary(locale, sectionPath);
        }
        return { outcome: "notFound" };
      }
    } else if (
      playlist.learningUnits.length >= VISIBLE_UNITS_PER_SECTION &&
      hydratedUnits.length < VISIBLE_UNITS_PER_SECTION
    ) {
      return { outcome: "notFound" };
    }

    const visibleStepCount = displaySession
      ? displaySession.visibleStepCount
      : playlist.learningUnits.length >= VISIBLE_UNITS_PER_SECTION
        ? VISIBLE_UNITS_PER_SECTION
        : learningUnits.length;

    const hasStep = sp.step != null && !isNaN(+sp.step) && +sp.step >= 1;
    const legacyPart =
      sp.part != null && !isNaN(+sp.part) && +sp.part >= 1
        ? Math.min(+sp.part, visibleStepCount)
        : null;

    if (!hasStep && legacyPart != null) {
      return { outcome: "redirect", pathname: sectionPath, query: {
            step: String(legacyPart),
            ...learnPlayerQueryExtras({
              initialAutoplay,
              reviewMode,
              batchReviewMode,
            }),
          }, locale };
    }

    if (!hasStep) {
      const defaultStart = resolveLearnPlayerStart({
        displaySession,
        requestedCanonicalStep: null,
        legacyPlaylistLength: visibleStepCount,
      });
      return { outcome: "redirect", pathname: sectionPath, query: {
            step: String(defaultStart.canonicalStep),
            ...learnPlayerQueryExtras({
              initialAutoplay,
              reviewMode,
              batchReviewMode,
            }),
          }, locale };
    }

    const playerStart = resolveLearnPlayerStart({
      displaySession,
      requestedCanonicalStep: +sp.step!,
      legacyPlaylistLength: visibleStepCount,
    });
    const { initialUnitIndex, canonicalStep: step } = playerStart;
    const startUnit = learningUnits[initialUnitIndex];
    if (!startUnit?.parts.length) return { outcome: "notFound" };
    const bookmarkOrder = bookmarkOrderForVisibleStep(sectionIndex, step);

    // UI last-seen bookmark only — must NOT call advanceLearningResume.
    // Opening a section via Library/Search/URL must not move Continue Learning.
    if (user && !reviewMode && !batchReviewMode) {
      deferred.push({
        kind: "bookmark",
        videoId,
        order: bookmarkOrder,
        seasonId,
        episodeId,
      });
    }

    const sessionStats = await getLearningSessionStats(user?.id);

    logSectionTransition({
      phase: "LearnPageContent.render-player",
      requestedSectionIndex: sectionIndex,
      renderedSectionIndex: sectionIndex,
      unlocked: true,
      summary: false,
      step,
      initialUnitIndex,
      learningUnitPartIds: flattenLearningUnitPartIds(learningUnits),
    });

    return {
      outcome: "player",
      deferred,
      props: {
        playerKey: `${videoId}-${episodeId}-s${sectionIndex}-step${step}-${reviewMode ? "review" : "learn"}`,
        learningUnits,
        displaySlots,
        composedDisplaySlots,
        initialUnitIndex,
        initialAutoplay,
        videoId,
        type: "series",
        seasonId,
        episodeId,
        sessionStats,
        reviewMode: reviewMode && !!user,
        reviewReturnPath: exitListHref,
        sectionNav: {
          sectionIndex,
          totalParts,
          totalSections,
          sectionPath,
          exitListHref,
        },
      },
    };
  }

  if (type === "movie" || type === "documentary") {
    if (!isContentIdParam(videoId)) {
      return learnNotFound("INVALID_VIDEO_ID", { videoId, type });
    }

    const [user, video, totalParts] = await Promise.all([
      getCurrentUser(),
      videoQueries.fetchStandaloneVideoLeanMeta(videoId),
      videoQueries.countPartsForVideoId(videoId),
    ]);
    if (user) {
      const canAccess = await userCanAccessLearning(user);
      if (!canAccess) {
        return { outcome: "learningBlocked", pathname: "/dashboard/plans", locale };
      }
    }

    if (!video || video.type !== type) {
      return learnNotFound("VIDEO_NOT_FOUND_OR_TYPE_MISMATCH", {
        videoId,
        type,
        videoType: video?.type ?? null,
      });
    }

    if (totalParts < 1) {
      return learnNotFound("VIDEO_HAS_NO_PARTS", { videoId, totalParts });
    }

    const legacyOrder =
      sp.order && !isNaN(+sp.order) && +sp.order >= 1 ? +sp.order : null;

    if (!isMovieSectionPath(rawParams) && legacyOrder != null) {
      const s = sectionIndexFromOrder(legacyOrder);
      return { outcome: "redirect", pathname: `/learn/${type}/${videoId}/section/${s}`, query: { step: "1" }, locale };
    }

    if (!isMovieSectionPath(rawParams)) {
      return { outcome: "redirect", pathname: `/learn/${type}/${videoId}/section/1`, query: { step: "1" }, locale };
    }

    const sectionIndex = +rawParams[1]!;
    const summary = sp.summary === "1";

    // Content access is unrestricted — sequential unlock is not an access gate.
    // Invalid indices are rejected via totalSections / empty playlist below.

    const sectionPath = `/learn/${type}/${videoId}/section/${sectionIndex}`;
    const exitListHref = `/movies/${videoId}/sections`;

    if (summary) {
      const summaryData = await loadSectionSummaryPageData({
        scope: { videoId, curriculumId: `video:${videoId}` },
        sectionIndex,
        userId: user?.id ?? null,
        totalParts,
        videoId,
      });

      if (!summaryData.found) {
        return learnNotFound("MOVIE_SUMMARY_NOT_FOUND", { videoId, sectionIndex });
      }

      // Do NOT redirect incomplete summary → ?step=1 (restarts finished sections).

      if (
        user &&
        summaryData.sectionComplete &&
        summaryData.nextSectionUnlocked
      ) {
        deferred.push(
          {
            kind: "bookmark",
            videoId,
            order: bookmarkOrderForVisibleStep(sectionIndex + 1, 1),
          },
          {
            kind: "advanceResume",
            videoId,
            resumeSection: sectionIndex + 1,
            resumePart: 1,
            unlockAtLeast: sectionIndex + 1,
          },
        );
      }

      const nextSectionHref = summaryData.nextSectionUnlocked
        ? `/learn/${type}/${videoId}/section/${sectionIndex + 1}?step=1`
        : null;

      logSectionTransition({
        phase: "LearnPageContent.render-summary",
        requestedSectionIndex: sectionIndex,
        renderedSectionIndex: sectionIndex,
        unlocked: true,
        summary: true,
        redirectTo: nextSectionHref ?? undefined,
      });

      return {
        outcome: "summary",
        deferred,
        props: {
          stats: summaryData.stats,
          sectionIndex,
          totalSections: summaryData.totalSections,
          contentTitle: video.name,
          nextSectionHref,
          exitHref: exitListHref,
          isLastSection: summaryData.isLastSection,
        },
      };
    }

    const curriculumId = `video:${videoId}`;
    const curriculumParts = await getVideoPartsOrderMeta(videoId);
    if (curriculumParts.length === 0) {
      return learnNotFound("CURRICULUM_PARTS_EMPTY", {
        videoId,
        totalParts,
        userId: user?.id ?? null,
      });
    }

    const globalOrder = await getAdaptiveEpisodeOrder({
      episodeParts: curriculumParts,
      user,
      context: { curriculumId, totalParts },
    });

    const totalSections = await countVisibleSections(globalOrder, user);
    if (sectionIndex > totalSections) {
      return learnNotFound("SECTION_INDEX_OUT_OF_RANGE", {
        sectionIndex,
        totalSections,
        globalOrder: globalOrder.length,
      });
    }

    const playlist = await getOrMaterializeProgressionSection({
      progressionScope: {
        scope: { videoId, curriculumId },
        videoId,
        episodeId: null,
      },
      sectionIndex,
      user,
      totalParts,
      mode: reviewMode ? "dynamic" : "get-or-create",
      options: {
        // Normal learner flow: one canonical clip per unit (see LEARNER_FORCE_ATOMIC_UNITS).
        forceAtomicUnits: true,
        sectionIndex,
        sectionId: `${curriculumId}:section:${sectionIndex}`,
      },
    });
    if (playlist.learningUnits.length === 0) {
      return learnNotFound("LEARN_SECTION_EMPTY_PLAYLIST", {
        sectionIndex,
        atomicPartCount: playlist.atomicPartCount,
        userId: user?.id ?? null,
        curriculumFirstIds: curriculumParts.slice(0, 3).map((p) => p.id),
      });
    }

    const { learningUnits: hydratedUnits, progressionUnits } =
      await hydrateVisibleSectionUnits(playlist);
    let learningUnits: LearningUnit<Part>[] =
      contentDifficultyFilter === "All"
        ? hydratedUnits
        : hydratedUnits.filter((unit) =>
            unit.parts.some((part) =>
              partMatchesContentDifficultyFilter(
                part.difficulty,
                contentDifficultyFilter,
              ),
            ),
          );
    let displaySlots: SectionDisplaySlot[] | undefined;
    let composedDisplaySlots: SectionDisplaySlot[] | undefined;
    let displaySession: LearnDisplaySessionResult | null = null;
    if (contentDifficultyFilter === "All") {
      displaySession = await resolveLearnDisplaySession({
        userId: user?.id ?? null,
        videoId,
        episodeId: null,
        sectionIndex,
        globalOrder,
        user,
        reviewMode,
        batchReviewMode,
        buildOptions: {
          forceAtomicUnits: true,
          sectionIndex,
          sectionId: `${curriculumId}:section:${sectionIndex}`,
        },
        progressionUnits,
      });
      if (displaySession) {
        displaySlots = displaySession.displaySlots;
        composedDisplaySlots = displaySession.composedDisplaySlots;
        learningUnits = displaySession.learningUnits;
        if (learningUnits.length === 0) {
          const kinds = countComposedDisplaySlotKinds(
            displaySession.composedDisplaySlots,
          );
          if (
            kinds.total > 0 &&
            kinds.playable === 0 &&
            !reviewMode &&
            !batchReviewMode
          ) {
            return redirectToSectionSummary(locale, sectionPath, contentDifficultyQuery);
          }
          return learnNotFound("LEARN_SECTION_PLAYABLE_EMPTY", {
            sectionIndex,
            composedSlots: displaySession.composedDisplaySlots.length,
          });
        }
      }
    }
    if (learningUnits.length === 0) {
      return learnNotFound("LEARN_SECTION_HYDRATE_EMPTY", {
        sectionIndex,
        playlistUnits: playlist.learningUnits.length,
        contentDifficultyFilter,
      });
    }
    if (
      contentDifficultyFilter === "All" &&
      !displaySlots &&
      playlist.learningUnits.length >= VISIBLE_UNITS_PER_SECTION &&
      learningUnits.length < VISIBLE_UNITS_PER_SECTION
    ) {
      return learnNotFound("LEARN_SECTION_HYDRATE_SHORT", {
        playlistUnits: playlist.learningUnits.length,
        hydratedUnits: learningUnits.length,
        visibleUnitsPerSection: VISIBLE_UNITS_PER_SECTION,
      });
    }

    const visibleStepCount =
      displaySlots != null
        ? Math.min(VISIBLE_UNITS_PER_SECTION, learningUnits.length)
        : contentDifficultyFilter === "All" &&
            playlist.learningUnits.length >= VISIBLE_UNITS_PER_SECTION
          ? VISIBLE_UNITS_PER_SECTION
          : learningUnits.length;

    const hasStep = sp.step != null && !isNaN(+sp.step) && +sp.step >= 1;
    const legacyPart =
      sp.part != null && !isNaN(+sp.part) && +sp.part >= 1
        ? Math.min(+sp.part, visibleStepCount)
        : null;

    if (!hasStep && legacyPart != null) {
      return { outcome: "redirect", pathname: sectionPath, query: {
            step: String(legacyPart),
            ...learnPlayerQueryExtras({
              initialAutoplay,
              reviewMode,
              batchReviewMode,
              contentDifficultyQuery,
            }),
          }, locale };
    }

    if (!hasStep) {
      const defaultStart = resolveLearnPlayerStart({
        displaySession,
        requestedCanonicalStep: null,
        legacyPlaylistLength: visibleStepCount,
      });
      return { outcome: "redirect", pathname: sectionPath, query: {
            step: String(defaultStart.canonicalStep),
            ...learnPlayerQueryExtras({
              initialAutoplay,
              reviewMode,
              batchReviewMode,
              contentDifficultyQuery,
            }),
          }, locale };
    }

    const playerStart = resolveLearnPlayerStart({
      displaySession,
      requestedCanonicalStep: +sp.step!,
      legacyPlaylistLength: visibleStepCount,
    });
    const { initialUnitIndex, canonicalStep: step } = playerStart;
    const startUnit = learningUnits[initialUnitIndex];
    if (!startUnit?.parts.length) {
      return learnNotFound("INVALID_STEP_OR_EMPTY_START_UNIT", {
        step,
        initialUnitIndex,
        visibleStepCount,
        startUnitParts: startUnit?.parts?.length ?? 0,
      });
    }
    const bookmarkOrder = bookmarkOrderForVisibleStep(sectionIndex, step);

    // UI last-seen bookmark only — must NOT call advanceLearningResume.
    if (user && !reviewMode && !batchReviewMode) {
      deferred.push({
        kind: "bookmark",
        videoId,
        order: bookmarkOrder,
      });
    }

    const sessionStats = await getLearningSessionStats(user?.id);

    logSectionTransition({
      phase: "LearnPageContent.render-player",
      requestedSectionIndex: sectionIndex,
      renderedSectionIndex: sectionIndex,
      unlocked: true,
      summary: false,
      step,
      initialUnitIndex,
      learningUnitPartIds: flattenLearningUnitPartIds(learningUnits),
    });

    return {
      outcome: "player",
      deferred,
      props: {
        playerKey: `${videoId}-s${sectionIndex}-step${step}-${reviewMode ? "review" : "learn"}`,
        learningUnits,
        displaySlots,
        composedDisplaySlots,
        initialUnitIndex,
        initialAutoplay,
        videoId,
        type: type as "movie" | "documentary",
        sessionStats,
        reviewMode: reviewMode && !!user,
        reviewReturnPath: exitListHref,
        sectionNav: {
          sectionIndex,
          totalParts,
          totalSections,
          sectionPath,
          exitListHref,
        },
      },
    };
  }

  return learnNotFound("UNSUPPORTED_LEARN_TYPE", { type, videoId, rawParams });
}
