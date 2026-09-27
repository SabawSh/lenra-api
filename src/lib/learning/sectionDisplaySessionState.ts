import type {
  SectionDisplaySlot,
  SectionSessionSlot,
} from "@/lib/learning/buildSectionDisplaySession";
import type { LearningUnit } from "@/lib/skill-engine/learning-units/types";
import type { Part } from "@/types/video";

export type DisplayClipLearningState = "new" | "review" | "completed";

export type SessionSlotDisplayKind = SectionSessionSlot["displayKind"];

/** Play playlist: composed batch order with completed slots removed only. */
export function playableDisplaySlotsFromComposed(
  composed: readonly SectionDisplaySlot[],
): SectionSessionSlot[] {
  return composed.filter(
    (slot): slot is SectionSessionSlot => slot.displayKind !== "completed",
  );
}

/** Full-batch replay — every composed slot is playable (completed → new for this session). */
export function sessionSlotsForBatchReview(
  composed: readonly SectionDisplaySlot[],
): SectionSessionSlot[] {
  return composed.map((slot) =>
    slot.displayKind === "completed"
      ? { displayKind: "new", unit: slot.unit }
      : slot,
  );
}

export function countComposedDisplaySlotKinds(
  composed: readonly Pick<SectionDisplaySlot, "displayKind">[],
): {
  completed: number;
  new: number;
  review: number;
  total: number;
  playable: number;
} {
  let completed = 0;
  let newCount = 0;
  let reviewCount = 0;
  for (const slot of composed) {
    if (slot.displayKind === "completed") completed += 1;
    else if (slot.displayKind === "review") reviewCount += 1;
    else newCount += 1;
  }
  return {
    completed,
    new: newCount,
    review: reviewCount,
    total: composed.length,
    playable: composed.length - completed,
  };
}

export function countSessionSlotDisplayKinds(
  slots: readonly Pick<SectionSessionSlot, "displayKind">[],
): { new: number; review: number; total: number } {
  let newCount = 0;
  let reviewCount = 0;
  for (const slot of slots) {
    if (slot.displayKind === "review") reviewCount += 1;
    else newCount += 1;
  }
  return { new: newCount, review: reviewCount, total: slots.length };
}

/** Map composed slot → batch preview / UI learning state (not underlying unit identity). */
export function clipCardStateForSessionSlot(
  slot: Pick<SectionSessionSlot, "displayKind">,
  qualifiedComplete: boolean,
): DisplayClipLearningState {
  if (slot.displayKind === "review") return "review";
  if (qualifiedComplete) return "completed";
  return "new";
}

export function partIdForSessionSlot(slot: SectionSessionSlot): string | null {
  const id = slot.unit.parts[0]?.id?.trim();
  return id || null;
}

/** Session slots and parallel learning units must stay index-aligned. */
export function sessionSlotsAlignWithUnits(
  slots: readonly SectionSessionSlot[],
  units: readonly LearningUnit<Part>[],
): boolean {
  if (slots.length !== units.length) return false;
  for (let i = 0; i < slots.length; i++) {
    const slotPart = partIdForSessionSlot(slots[i]!);
    const unitPart = units[i]?.parts[0]?.id?.trim() ?? null;
    if (!slotPart || slotPart !== unitPart) return false;
  }
  return true;
}

export function displayKindAtStep(
  slots: readonly SectionSessionSlot[] | undefined,
  stepIndex0: number,
): SessionSlotDisplayKind {
  return slots?.[stepIndex0]?.displayKind ?? "new";
}

/** 1-based index in the full composed batch (includes completed slots). */
export function canonicalStepForPartId(
  composed: readonly SectionDisplaySlot[],
  partId: string,
): number | null {
  const id = partId.trim();
  if (!id) return null;
  for (let i = 0; i < composed.length; i++) {
    if (composed[i]!.unit.parts[0]?.id?.trim() === id) return i + 1;
  }
  return null;
}

/** 1-based canonical step for a 0-based index in the playable playlist. */
export function canonicalStepForPlayableIndex(
  composed: readonly SectionDisplaySlot[],
  playable: readonly SectionSessionSlot[],
  playableIndex0: number,
): number {
  const slot = playable[playableIndex0];
  const partId = slot?.unit.parts[0]?.id;
  if (!partId) return Math.max(1, playableIndex0 + 1);
  return canonicalStepForPartId(composed, partId) ?? Math.max(1, playableIndex0 + 1);
}

export function composedBatchHasIncompleteSlots(
  composed: readonly SectionDisplaySlot[],
): boolean {
  return composed.some((slot) => slot.displayKind !== "completed");
}

/**
 * Map `?step=` (canonical 1-based position in the composed batch) to the
 * playable playlist index. Never treat canonical step as a playable index.
 */
/** `?step=` for batch review — 1:1 with composed order (includes replay of completed clips). */
export function resolveBatchReviewSessionStart(params: {
  composedDisplaySlots: readonly SectionDisplaySlot[];
  requestedCanonicalStep?: number | null;
}): { playableStep: number; playableIndex0: number; canonicalStep: number } {
  const total = params.composedDisplaySlots.length;
  if (total === 0) {
    return { playableStep: 1, playableIndex0: 0, canonicalStep: 1 };
  }
  const raw = params.requestedCanonicalStep;
  const step =
    raw == null || !Number.isFinite(raw) || raw < 1
      ? 1
      : Math.min(Math.floor(raw), total);
  return {
    playableStep: step,
    playableIndex0: step - 1,
    canonicalStep: step,
  };
}

export function resolvePlayableSessionStart(params: {
  composedDisplaySlots: readonly SectionDisplaySlot[];
  playableSlots: readonly SectionSessionSlot[];
  requestedCanonicalStep?: number | null;
}): { playableStep: number; playableIndex0: number; canonicalStep: number } {
  const firstIncomplete = (): {
    playableStep: number;
    playableIndex0: number;
    canonicalStep: number;
  } => {
    for (let i = 0; i < params.composedDisplaySlots.length; i++) {
      const slot = params.composedDisplaySlots[i]!;
      if (slot.displayKind === "completed") continue;
      const partId = slot.unit.parts[0]?.id?.trim();
      if (!partId) continue;
      const playableIndex0 = params.playableSlots.findIndex(
        (p) => p.unit.parts[0]?.id?.trim() === partId,
      );
      if (playableIndex0 >= 0) {
        return {
          playableStep: playableIndex0 + 1,
          playableIndex0,
          canonicalStep: i + 1,
        };
      }
    }
    return { playableStep: 1, playableIndex0: 0, canonicalStep: 1 };
  };

  const req = params.requestedCanonicalStep;
  if (req == null || !Number.isFinite(req) || req < 1) {
    return firstIncomplete();
  }

  const composedIndex = Math.floor(req) - 1;
  if (
    composedIndex < 0 ||
    composedIndex >= params.composedDisplaySlots.length
  ) {
    return firstIncomplete();
  }

  const requested = params.composedDisplaySlots[composedIndex]!;
  if (requested.displayKind === "completed") {
    return firstIncomplete();
  }

  const partId = requested.unit.parts[0]?.id?.trim();
  if (!partId) return firstIncomplete();

  const playableIndex0 = params.playableSlots.findIndex(
    (p) => p.unit.parts[0]?.id?.trim() === partId,
  );
  if (playableIndex0 < 0) return firstIncomplete();

  const mapped = {
    playableStep: playableIndex0 + 1,
    playableIndex0,
    canonicalStep: composedIndex + 1,
  };
  const first = firstIncomplete();
  if (mapped.canonicalStep > first.canonicalStep) {
    return first;
  }
  return mapped;
}
