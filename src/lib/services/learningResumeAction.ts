"use server";

import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { advanceLearningResume } from "@/lib/db/learningResume";

type AdvanceParams = {
  videoId: string;
  seasonId?: string;
  episodeId?: string;
  resumeSection: number;
  resumePart: number;
  unlockAtLeast?: number;
};

/**
 * Client entry for Continue Learning journey advances (next / auto-advance).
 * Passes the next lesson to open (already advanced past the completed unit).
 * Forward-only; reviewing older sections is a no-op server-side.
 */
export async function advanceLearningResumeAction(params: AdvanceParams) {
  const user = await getCurrentUser();
  if (!user) return;
  await advanceLearningResume({
    userId: user.id,
    videoId: params.videoId,
    seasonId: params.seasonId,
    episodeId: params.episodeId,
    resumeSection: params.resumeSection,
    resumePart: params.resumePart,
    unlockAtLeast: params.unlockAtLeast,
  });
}
