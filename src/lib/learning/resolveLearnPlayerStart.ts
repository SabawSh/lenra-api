import type { LearnDisplaySessionResult } from "@/lib/learning/resolveLearnDisplaySession";
import {
  resolveBatchReviewSessionStart,
  resolvePlayableSessionStart,
} from "@/lib/learning/sectionDisplaySessionState";
import { clampSessionStep } from "@/lib/learning/sessionStep";

export type LearnPlayerStart = {
  /** 0-based index in the playable `learningUnits` playlist. */
  initialUnitIndex: number;
  /** 1-based step in the full composed batch (for `?step=` and bookmarks). */
  canonicalStep: number;
  /** 1-based step within the playable playlist (player UI). */
  playableStep: number;
};

export function resolveLearnPlayerStart(params: {
  displaySession: LearnDisplaySessionResult | null;
  requestedCanonicalStep: number | null;
  legacyPlaylistLength: number;
}): LearnPlayerStart {
  if (params.displaySession) {
    const resolved = params.displaySession.batchReview
      ? resolveBatchReviewSessionStart({
          composedDisplaySlots: params.displaySession.composedDisplaySlots,
          requestedCanonicalStep: params.requestedCanonicalStep,
        })
      : resolvePlayableSessionStart({
          composedDisplaySlots: params.displaySession.composedDisplaySlots,
          playableSlots: params.displaySession.displaySlots,
          requestedCanonicalStep: params.requestedCanonicalStep,
        });
    return {
      initialUnitIndex: resolved.playableIndex0,
      canonicalStep: resolved.canonicalStep,
      playableStep: resolved.playableStep,
    };
  }

  const step = clampSessionStep(
    params.requestedCanonicalStep ?? 1,
    params.legacyPlaylistLength,
  );
  return {
    initialUnitIndex: step - 1,
    canonicalStep: step,
    playableStep: step,
  };
}
