import { findLearningResumeForVideo } from "@/lib/db/queries/userLearningResume";
import type { UserId } from "@/types/schema";

export type StoredUnlockState = {
  resumeSection: number | null;
  resumePart: number | null;
  /**
   * Highest learner-visible section that is unlocked (playable).
   * Never derived from resumeSection at read time.
   */
  highestUnlockedSection: number;
};

function sectionUnlockDebugEnabled(): boolean {
  return process.env.DEBUG_SECTION_UNLOCK === "1";
}

/** Structured log — Continue Learning vs Sections must each use their own field. */
export function logStoredUnlockState(
  scope: string,
  state: StoredUnlockState & {
    continueHrefSection?: number | null;
    highestRenderedUnlockedSection?: number | null;
  },
): void {
  if (!sectionUnlockDebugEnabled()) return;
}

/**
 * Read unlock state from user_learning_resume only.
 *
 * - Continue Learning → resumeSection / resumePart
 * - Sections map → highestUnlockedSection
 *
 * No catalog merge. No max(resumeSection). Default unlocked floor is 1.
 */
export async function resolveStoredUnlockState(params: {
  userId: UserId | null;
  videoId: string | null | undefined;
  logScope?: string;
}): Promise<StoredUnlockState> {
  if (!params.userId || !params.videoId) {
    const state: StoredUnlockState = {
      resumeSection: null,
      resumePart: null,
      highestUnlockedSection: 1,
    };
    if (params.logScope) logStoredUnlockState(params.logScope, state);
    return state;
  }

  const resume = await findLearningResumeForVideo(params.userId, params.videoId);
  if (!resume) {
    const state: StoredUnlockState = {
      resumeSection: null,
      resumePart: null,
      highestUnlockedSection: 1,
    };
    if (params.logScope) logStoredUnlockState(params.logScope, state);
    return state;
  }

  const state: StoredUnlockState = {
    resumeSection: resume.resumeSection,
    resumePart: resume.resumePart,
    highestUnlockedSection: Math.max(1, resume.highestUnlockedSection),
  };

  if (params.logScope) {
    logStoredUnlockState(params.logScope, {
      ...state,
      continueHrefSection: resume.resumeSection,
    });
  }

  return state;
}
