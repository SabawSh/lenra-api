import type {
  AdaptivePartInput,
  OrderingDiagnostics,
  PartProgress,
} from "@/lib/skill-engine/domain/types";
import { getOrderingSignal } from "@/lib/skill-engine/ordering/orderingSignal";
import {
  masteryScoreOfProgress,
  resolvePartState,
} from "@/lib/skill-engine/state/resolvePartState";

export function resolveOrderingDiagnostics(
  progress: PartProgress | null | undefined,
): OrderingDiagnostics {
  const state = resolvePartState(progress);
  const masteryScore = masteryScoreOfProgress(progress);
  return {
    state,
    orderingSignal: getOrderingSignal(progress),
    masteryScore,
  };
}

/** Payload for `[adaptive-ordering-decision]` log `inputs` — shape unchanged. */
export function adaptiveOrderingDecisionInputs(
  adaptiveInputs: AdaptivePartInput[],
): Array<{
  id: string;
  difficultyScore: number | null;
  difficulty: AdaptivePartInput["difficulty"];
  state: OrderingDiagnostics["state"];
  orderingSignal: OrderingDiagnostics["orderingSignal"];
  masteryScore: OrderingDiagnostics["masteryScore"];
  attempts: number | null;
  wrongMoves: number | null;
  bestScore: number | null;
  completedAt: string | null;
}> {
  return adaptiveInputs.map((p) => {
    const diag = resolveOrderingDiagnostics(p.progress);
    return {
      id: p.id,
      difficultyScore: p.difficultyScore,
      difficulty: p.difficulty,
      state: diag.state,
      orderingSignal: diag.orderingSignal,
      masteryScore: diag.masteryScore,
      attempts: p.progress?.attempts ?? null,
      wrongMoves: p.progress?.wrongMoves ?? null,
      bestScore: p.progress?.bestScore ?? null,
      completedAt: p.progress?.completedAt?.toISOString() ?? null,
    };
  });
}
