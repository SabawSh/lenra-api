
import type { UserId } from "@/types/schema";
import { awardXp } from "@/lib/gamification/awardXp";
import { clipXpAmount } from "@/lib/gamification/clipXp";
import {
  toClipXpAwardResult,
  type ClipXpAwardResult,
  type XpReason,
} from "@/lib/gamification/xp";

export { CLIP_XP_DRAG, CLIP_XP_VOICE, clipXpAmount } from "@/lib/gamification/clipXp";

export type ClipPerformanceXpParams = {
  userId: UserId;
  partId: string;
  score: number;
  inputMode?: "drag" | "voice";
  accuracy?: number;
  speed?: number;
  modeBonus?: number;
  clipDifficulty?: "easy" | "medium" | "hard";
  difficultyScore?: number | null;
  wasAlreadyCompleted: boolean;
  previousBestScore: number;
  streakAdvancedToday?: boolean;
  wrongMoves?: number;
  hintsUsed?: number;
  /** When set, skips recomputing clip XP (must match persisted `xp_earned` delta). */
  amount?: number;
};

export type ClipPerformanceXpResult = ClipXpAwardResult & {
  primaryReason: XpReason | null;
};

/** Awards XP from clip performance only. */
export async function awardClipPerformanceXp(
  params: ClipPerformanceXpParams,
): Promise<ClipPerformanceXpResult | null> {
  if (params.score <= 0) {
    return null;
  }

  const fullAmount =
    params.amount ??
    clipXpAmount(params.inputMode, {
      score: params.score,
      accuracy: params.accuracy,
      speed: params.speed,
      modeBonus: params.modeBonus,
      wrongMoves: params.wrongMoves,
      hintsUsed: params.hintsUsed,
      clipDifficulty: params.clipDifficulty,
      difficultyScore: params.difficultyScore,
    });
  // Replays are rewarded exactly like first completions.
  const amount = fullAmount;

  const award = await awardXp({
    userId: params.userId,
    amount,
    reason: "complete_clip",
  });

  if (award.xpGained <= 0) {
    return null;
  }

  return {
    ...toClipXpAwardResult(award),
    primaryReason: "complete_clip",
  };
}
