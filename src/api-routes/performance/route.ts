// app/api/performance/route.ts
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  getStreakForUser,
  recordLearningActivityDay,
} from "@/lib/db/learningStreak";
import { fetchDailyXpForDayKey } from "@/lib/db/queries/dailyUserStats";
import { findUserStreakSliceById } from "@/lib/db/queries/users";
import { fetchUserGamification } from "@/lib/db/userGamificationRow";
import { localDateKey } from "@/lib/db/localDateKey";
import { syncUserAchievements } from "@/lib/achievements/engine";
import { awardClipPerformanceXp } from "@/lib/gamification/learningXp";
import { clipXpAmount } from "@/lib/gamification/clipXp";
import { calculatePerformance } from "@/lib/performance/calculatePerformance";
import {
  aggregateSessionMetric,
  countSessionAttempts,
} from "@/lib/performance/sessionAttempts";
import {
  fetchUserPartProgressRow,
  upsertUserPartProgress,
} from "@/lib/db/queries/userPartProgress";
import { fetchPartRowById } from "@/lib/db/queries/videos";
import type { PerformanceRaw } from "@/types/learning";
import { revalidateUserProgressTags } from "@/lib/cache/revalidateUserProgress";
import { isSectionFullyComplete } from "@/lib/db/sectionProgress";
import {
  fetchPartAdaptiveSectionContext,
  sectionScopeParams,
} from "@/lib/skill/resolvePartSectionScope";
import { applySectionSkillUpdateOnTransition } from "@/lib/skill/sectionSkill";
import { saveUserEpisodeLastPosition } from "@/lib/db/lastSeen";
import {
  advanceLearningResume,
  nextResumeAfterCompletion,
} from "@/lib/db/learningResume";
import { isContentIdParam } from "@/lib/ids/contentId";
import { NextResponse } from "next/server";
import { runAfterResponse } from "@/lib/runAfterResponse";

type PerformanceBody = {
  partId: string;
  raw: PerformanceRaw;
  /** Last clip of a section reached (e.g. skip) — unlocks section summary even at score 0. */
  sectionEndReach?: boolean;
  /** User skipped the clip — force score 0 (do not keep a previous best). */
  skipped?: boolean;
  /** Earlier atomic clips merged into the same learning unit (progress mirror only). */
  companionPartIds?: string[];
  /** Session section + step from the learn player (matches section page bookmark). */
  sessionSectionIndex?: number;
  visibleUnitStep?: number;
  videoId?: string;
  seasonId?: string;
  episodeId?: string;
  /** Review sessions must not advance the Continue Learning pointer. */
  reviewMode?: boolean;
};

function normalizePerformanceRaw(
  partId: string,
  raw: PerformanceRaw | null | undefined,
): PerformanceRaw | null {
  if (!raw || typeof raw !== "object") return null;
  const attempts = Number(raw.attempts);
  const startedAt = Number(raw.startedAt);
  const finishedAt = Number(raw.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    return null;
  }
  return {
    ...raw,
    unitId: typeof raw.unitId === "string" && raw.unitId ? raw.unitId : partId,
    totalWords: Math.max(0, Number(raw.totalWords) || 0),
    correctWords: Math.max(0, Number(raw.correctWords) || 0),
    attemptedWords: Math.max(0, Number(raw.attemptedWords) || 0),
    wrongMoves: Math.max(0, Number(raw.wrongMoves) || 0),
    hintsUsed: Math.max(0, Number(raw.hintsUsed) || 0),
    videoDurationMs: Math.max(0, Number(raw.videoDurationMs) || 0),
    inputMode: raw.inputMode === "voice" ? "voice" : "drag",
    startedAt,
    finishedAt: Math.max(finishedAt, startedAt + 1),
    attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 1,
  };
}

export async function POST(req: Request) {
  console.time("reminder-click-api-performance-server");
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as PerformanceBody;

    const partId = typeof body.partId === "string" ? body.partId.trim() : "";
    const { sectionEndReach, skipped } = body;
    const raw = normalizePerformanceRaw(partId, body.raw);

    if (!partId || !raw) {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const part = await fetchPartRowById(partId);
    if (!part) {
      return NextResponse.json({ error: "invalid_part" }, { status: 400 });
    }

    let perf: ReturnType<typeof calculatePerformance>;
    try {
      perf = calculatePerformance(raw);
    } catch (err) {
      console.error("[performance] calculatePerformance failed", err);
      return NextResponse.json({ error: "invalid_raw" }, { status: 400 });
    }
    const sentenceInputMode =
      raw?.inputMode === "drag" || raw?.inputMode === "voice"
        ? raw.inputMode
        : undefined;

    const existing = await fetchUserPartProgressRow(user.id, partId);

    const wasAlreadyCompleted = Boolean(existing?.completedAt);
    const previousBestScore = existing?.bestScore ?? 0;

    const bestScore = skipped
      ? 0
      : existing
        ? Math.max(existing.bestScore, perf.score)
        : perf.score;
    const bestScoreImproved =
      !skipped && perf.score > 0 && bestScore > previousBestScore;
    const lastScore = skipped ? 0 : perf.score;
    const previousWrongMoves = existing?.wrongMoves ?? 0;
    const sessionWrongMoves = skipped
      ? 0
      : Math.max(0, Math.floor(raw.wrongMoves) || 0);
    const wrongMoves = previousWrongMoves + sessionWrongMoves;

    const previousAttempts = existing?.attempts ?? 0;
    const sessionAttempts = skipped
      ? 1
      : Math.max(
          1,
          Number.isFinite(raw.attempts) && raw.attempts > 0
            ? Math.floor(raw.attempts)
            : countSessionAttempts(raw),
        );
    const attempts = previousAttempts + sessionAttempts;

    const accuracy = skipped
      ? 0
      : aggregateSessionMetric(
          existing?.accuracy ?? perf.accuracy,
          previousAttempts,
          perf.accuracy,
          sessionAttempts,
        );
    const speed = skipped
      ? 0
      : aggregateSessionMetric(
          existing?.speed ?? perf.speed,
          previousAttempts,
          perf.speed,
          sessionAttempts,
        );

    const completedAt =
      perf.score > 0 || sectionEndReach
        ? new Date()
        : (existing?.completedAt ?? null);

    const rawSessionSection = Number(body.sessionSectionIndex);
    const rawVisibleUnitStep = Number(body.visibleUnitStep);
    const sessionPlacement =
      Number.isFinite(rawSessionSection) &&
      rawSessionSection >= 1 &&
      Number.isFinite(rawVisibleUnitStep) &&
      rawVisibleUnitStep >= 1
        ? {
            sessionSectionIndex: Math.trunc(rawSessionSection),
            visibleUnitStep: Math.trunc(rawVisibleUnitStep),
          }
        : null;
    // Persist placement on scored completion (incl. review of already-complete clips).
    const placementForProgress =
      sessionPlacement && (completedAt != null || perf.score > 0)
        ? sessionPlacement
        : null;

    const xpThisAttempt =
      !skipped && perf.score > 0
        ? clipXpAmount(sentenceInputMode, {
            score: perf.score,
            accuracy: perf.accuracy,
            speed: perf.speed,
            modeBonus: perf.modeBonus,
            wrongMoves: sessionWrongMoves,
            hintsUsed: perf.hintsUsed,
            clipDifficulty: raw.challenge?.clipDifficulty,
            difficultyScore: raw.challenge?.difficultyScore,
          })
        : 0;
    // Best single-award amount for section summary — wallet still awards every run.
    const xpEarned = Math.max(existing?.xpEarned ?? 0, xpThisAttempt);

    const progress = await upsertUserPartProgress({
      userId: user.id,
      partId,
      attempts,
      wrongMoves,
      lastScore,
      bestScore,
      accuracy,
      speed,
      durationSec: skipped ? 0 : perf.durationSec,
      lastAttemptAt: completedAt ?? new Date(),
      completedAt,
      ...(sentenceInputMode !== undefined
        ? { lastSentenceInputMode: sentenceInputMode }
        : {}),
      ...(placementForProgress
        ? {
            sessionSectionIndex: placementForProgress.sessionSectionIndex,
            visibleUnitStep: placementForProgress.visibleUnitStep,
          }
        : {}),
      xpEarned,
    });

    const companionIds = Array.isArray(body.companionPartIds)
      ? body.companionPartIds.filter(
          (id): id is string =>
            typeof id === "string" && id.trim().length > 0 && id !== partId,
        )
      : [];

    if (companionIds.length > 0 && (perf.score > 0 || sectionEndReach)) {
      await Promise.all(
        companionIds.map(async (companionId) => {
          const companionPart = await fetchPartRowById(companionId);
          if (!companionPart) return;
          const companionExisting = await fetchUserPartProgressRow(
            user.id,
            companionId,
          );
          await upsertUserPartProgress({
            userId: user.id,
            partId: companionId,
            attempts: (companionExisting?.attempts ?? 0) + 1,
            wrongMoves: companionExisting?.wrongMoves ?? 0,
            lastScore: bestScore,
            bestScore: Math.max(companionExisting?.bestScore ?? 0, bestScore),
            accuracy: companionExisting?.accuracy ?? accuracy,
            speed: companionExisting?.speed ?? speed,
            durationSec: companionExisting?.durationSec ?? 0,
            lastAttemptAt: completedAt ?? new Date(),
            completedAt,
            ...(sentenceInputMode !== undefined
              ? { lastSentenceInputMode: sentenceInputMode }
              : {}),
            ...(placementForProgress
              ? {
                  sessionSectionIndex: placementForProgress.sessionSectionIndex,
                  visibleUnitStep: placementForProgress.visibleUnitStep,
                }
              : {}),
            xpEarned: companionExisting?.xpEarned ?? 0,
          });
        }),
      );
    }

    revalidateUserProgressTags();

    const sessionSectionIndex = sessionPlacement?.sessionSectionIndex;
    const visibleUnitStep = sessionPlacement?.visibleUnitStep;
    const reviewMode = body.reviewMode === true;
    if (
      !reviewMode &&
      typeof body.videoId === "string" &&
      isContentIdParam(body.videoId) &&
      sessionSectionIndex != null &&
      visibleUnitStep != null &&
      (perf.score > 0 || sectionEndReach)
    ) {
      const seasonId =
        typeof body.seasonId === "string" && isContentIdParam(body.seasonId)
          ? body.seasonId
          : null;
      const episodeId =
        typeof body.episodeId === "string" && isContentIdParam(body.episodeId)
          ? body.episodeId
          : null;

      // Journey pointer = next lesson to open (not the lesson just completed).
      const nextResume = nextResumeAfterCompletion({
        completedSection: sessionSectionIndex,
        completedPart: visibleUnitStep,
        sectionEndReach,
      });
      await advanceLearningResume({
        userId: user.id,
        videoId: body.videoId,
        seasonId,
        episodeId,
        resumeSection: nextResume.resumeSection,
        resumePart: nextResume.resumePart,
        ...(nextResume.unlockAtLeast != null
          ? { unlockAtLeast: nextResume.unlockAtLeast }
          : {}),
      });

      // Optional UI bookmark for Sections map — not Continue Learning.
      if (seasonId && episodeId) {
        await saveUserEpisodeLastPosition({
          userId: user.id,
          videoId: body.videoId,
          seasonId,
          episodeId,
          sectionIndex: sessionSectionIndex,
          partInSection: visibleUnitStep,
        });
      }
    }

    await recordLearningActivityDay(user.id);

    const streakRow = await findUserStreakSliceById(user.id);
    const streakCurrent = streakRow
      ? Number(streakRow.learningStreakCurrent)
      : 0;

    // Section skill EMA must finish before the response so the client can show
    // promote/downgrade feedback. Deduped per section_key; KEEP is omitted.
    let adaptiveTeacher: {
      decision: "UPGRADE" | "DOWNGRADE";
      previousLevel: string;
      newLevel: string;
    } | null = null;
    try {
      const sectionCtx = await fetchPartAdaptiveSectionContext(part, user.id);
      if (sectionCtx) {
        const isSectionCompletedNow = await isSectionFullyComplete({
          userId: user.id,
          ...sectionScopeParams(sectionCtx),
        });
        if (isSectionCompletedNow) {
          const teacherDecision = await applySectionSkillUpdateOnTransition(
            user.id,
            sectionCtx,
          );
          if (
            teacherDecision &&
            (teacherDecision.decision === "UPGRADE" ||
              teacherDecision.decision === "DOWNGRADE")
          ) {
            adaptiveTeacher = {
              decision: teacherDecision.decision,
              previousLevel: teacherDecision.previousLevel,
              newLevel: teacherDecision.newLevel,
            };
          }
        }
      }
    } catch (err) {
      console.error("[performance] section skill update failed", err);
    }

    // Non-critical: XP, achievements, cache — still run, not awaited by client.
    runAfterResponse(async () => {
      try {
        const streakBefore = await getStreakForUser(user.id);

        const streakAfterRow = await findUserStreakSliceById(user.id);
        const streakAfter = streakAfterRow
          ? Number(streakAfterRow.learningStreakCurrent)
          : 0;
        const streakAdvancedToday =
          streakAfter > streakBefore.current && perf.score > 0;

        const clipAward =
          perf.score > 0
            ? await awardClipPerformanceXp({
                userId: user.id,
                partId,
                score: perf.score,
                inputMode: sentenceInputMode,
                accuracy: perf.accuracy,
                speed: perf.speed,
                modeBonus: perf.modeBonus,
                wrongMoves: perf.wrongMoves,
                hintsUsed: perf.hintsUsed,
                clipDifficulty: raw.challenge?.clipDifficulty,
                difficultyScore: raw.challenge?.difficultyScore,
                wasAlreadyCompleted,
                previousBestScore,
                streakAdvancedToday,
                amount: xpThisAttempt,
              }).catch((err) => {
                console.error(
                  "[performance] awardClipPerformanceXp failed",
                  err,
                );
                return null;
              })
            : null;

        await Promise.all([
          fetchDailyXpForDayKey(user.id, localDateKey()),
          fetchUserGamification(user.id),
          syncUserAchievements(user.id).catch((err) => {
            console.error("[performance] syncUserAchievements failed", err);
            return {
              newlyUnlocked: [] as const,
              totalXpAwarded: 0,
              leveledUp: false,
              newLevel: 1,
            };
          }),
        ]);

        revalidateUserProgressTags();
      } catch (err) {
        console.error("[performance] deferred work failed", err);
      }
    });

    return NextResponse.json({
      success: true,
      progress,
      achievementsUnlocked: [],
      achievementXpAwarded: 0,
      adaptiveTeacher,
      xp: {
        earned: 0,
        streakCurrent,
        dailyXp: 0,
        totalXp: 0,
        level: 0,
        gamification: null,
        achievementsUnlocked: [],
        achievementXpAwarded: 0,
      },
    });
  } catch (err) {
    console.error("Performance API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  } finally {
    console.timeEnd("reminder-click-api-performance-server");
  }
}
