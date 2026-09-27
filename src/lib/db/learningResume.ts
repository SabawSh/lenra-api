import type { UserId } from "@/types/schema";
import {
  findLearningResumeForVideo,
  upsertLearningResume,
  type UserLearningResumeRecord,
} from "@/lib/db/queries/userLearningResume";
import {
  ensureCanonicalShellForVideo,
  fetchVideoScalarsById,
  isStandaloneVideoType,
} from "@/lib/db/queries/videos";
import type { UserLastPosition } from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";

export type { UserLearningResumeRecord };

/**
 * Next-lesson pointer for Sections map CTAs (same source as Dashboard Continue Learning).
 * Returns null when resume belongs to a different episode of the series.
 */
export async function getLearningResumePosition(params: {
  userId: UserId;
  videoId: string;
  episodeId?: string | null;
}): Promise<UserLastPosition | null> {
  try {
    const resume = await findLearningResumeForVideo(
      params.userId,
      params.videoId,
    );
    if (!resume) return null;
    if (
      params.episodeId &&
      resume.episodeId &&
      resume.episodeId !== params.episodeId
    ) {
      return null;
    }
    return {
      sectionIndex: resume.resumeSection,
      visibleUnitStep: resume.resumePart,
    };
  } catch {
    return null;
  }
}

export type AdvanceLearningResumeParams = {
  userId: UserId;
  videoId: string;
  seasonId?: string | null;
  episodeId?: string | null;
  /**
   * Next lesson the learner should open (not the lesson just completed).
   * Callers that know a completion should use {@link nextResumeAfterCompletion}.
   */
  resumeSection: number;
  resumePart: number;
  /**
   * Raise the unlock floor to at least this learner-visible section index.
   * Callers pass the newly unlocked playable section (completed + 1).
   * Never decreases `highestUnlockedSection`.
   */
  unlockAtLeast?: number;
};

/**
 * Map a completed lesson to the next playable Continue Learning target.
 *
 * Field responsibilities (learner-visible sections only):
 * - resumeSection/resumePart = next lesson to open (Continue Learning)
 * - unlockAtLeast = newly unlocked playable section (= completed + 1)
 * - Completing section N unlocks N+1 only — never N+2
 */
export function nextResumeAfterCompletion(params: {
  completedSection: number;
  completedPart: number;
  /** True when this completion finished the section's last visible unit. */
  sectionEndReach?: boolean;
}): {
  resumeSection: number;
  resumePart: number;
  /** Newly unlocked playable section (raises highestUnlockedSection). */
  unlockAtLeast?: number;
} {
  const section = clampSection(params.completedSection);
  const part = clampPart(params.completedPart);
  const atSectionEnd =
    params.sectionEndReach === true || part >= VISIBLE_UNITS_PER_SECTION;

  if (atSectionEnd) {
    return {
      resumeSection: section + 1,
      resumePart: 1,
      // Unlock the next playable section — not the completed one.
      unlockAtLeast: section + 1,
    };
  }

  // Mid-section: advance resume only — do not raise unlock floor.
  return {
    resumeSection: section,
    resumePart: part + 1,
  };
}

function clampPart(part: number): number {
  return Math.max(1, Math.min(Math.trunc(part), VISIBLE_UNITS_PER_SECTION));
}

function clampSection(section: number): number {
  return Math.max(1, Math.trunc(section));
}

function isForward(
  nextSection: number,
  nextPart: number,
  prevSection: number,
  prevPart: number,
): boolean {
  if (nextSection > prevSection) return true;
  if (nextSection < prevSection) return false;
  return nextPart > prevPart;
}

/**
 * Advance the Continue Learning journey pointer to the next lesson to open.
 *
 * Rules:
 * - Stored resume coordinates are the next playable lesson (not last completed).
 * - Resume only moves forward (section, then part).
 * - Reviewing / revisiting an older section never overwrites a later pointer.
 * - `highestUnlockedSection` only increases (highest playable unlocked section).
 * - Unlock is never inferred from resumeSection — only from explicit unlockAtLeast.
 */
export async function advanceLearningResume(
  params: AdvanceLearningResumeParams,
): Promise<UserLearningResumeRecord | null> {
  const resumeSection = clampSection(params.resumeSection);
  const resumePart = clampPart(params.resumePart);
  // Unlock floor only moves when caller explicitly passes unlockAtLeast
  // (newly unlocked playable section). Never infer unlock from the resume
  // pointer — resume is "next lesson", not "section unlocked".
  const unlockAtLeast =
    params.unlockAtLeast != null ? clampSection(params.unlockAtLeast) : null;

  try {
    let seasonId = params.seasonId ?? null;
    let episodeId = params.episodeId ?? null;
    if (seasonId == null && episodeId == null) {
      const video = await fetchVideoScalarsById(params.videoId);
      if (video && isStandaloneVideoType(video.type)) {
        const shell = await ensureCanonicalShellForVideo(params.videoId);
        seasonId = shell.seasonId;
        episodeId = shell.episodeId;
      }
    }

    const existing = await findLearningResumeForVideo(
      params.userId,
      params.videoId,
    );

    const prevSection = existing?.resumeSection ?? 1;
    const prevPart = existing?.resumePart ?? 1;
    const prevUnlock = existing?.highestUnlockedSection ?? 1;

    const highestUnlockedSection =
      unlockAtLeast != null ? Math.max(prevUnlock, unlockAtLeast) : prevUnlock;

    const moveResume = !existing
      ? true
      : isForward(resumeSection, resumePart, prevSection, prevPart);

    const nextSection = moveResume ? resumeSection : prevSection;
    const nextPart = moveResume ? resumePart : prevPart;
    const nextSeasonId = moveResume
      ? seasonId
      : (existing?.seasonId ?? seasonId);
    const nextEpisodeId = moveResume
      ? episodeId
      : (existing?.episodeId ?? episodeId);

    const unlockOnly =
      !moveResume && highestUnlockedSection > prevUnlock && existing != null;

    if (!moveResume && !unlockOnly && existing) {
      return existing;
    }

    await upsertLearningResume({
      userId: params.userId,
      videoId: params.videoId,
      seasonId: nextSeasonId,
      episodeId: nextEpisodeId,
      resumeSection: nextSection,
      resumePart: nextPart,
      highestUnlockedSection,
    });

    return {
      id: existing?.id ?? 0,
      userId: params.userId,
      videoId: params.videoId,
      seasonId: nextSeasonId,
      episodeId: nextEpisodeId,
      resumeSection: nextSection,
      resumePart: nextPart,
      highestUnlockedSection,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
  } catch {
    // Database unavailable in local/dev contexts.
    return null;
  }
}
