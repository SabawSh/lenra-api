/**
 * Temporary section 22→23 playback investigation.
 *
 * Enable:
 *   NEXT_PUBLIC_DEBUG_SECTION_TRANSITION=1
 * (also on in `next dev` so a local reproduction prints without extra env)
 *
 * Look for `[section-transition]` in the server terminal and the browser console.
 */

export type SectionTransitionTrace = {
  phase: string;
  url?: string;
  requestedSectionIndex?: number;
  renderedSectionIndex?: number;
  highestUnlockedSection?: number | null;
  unlocked?: boolean;
  redirectTo?: string;
  redirectQuery?: Record<string, string>;
  summary?: boolean;
  step?: number | string | null;
  learningUnitPartIds?: readonly string[];
  sessionUnitPartIds?: readonly string[];
  initialUnitIndex?: number;
  currentUnitIndex?: number;
  containerMountId?: string;
  boundaryKey?: string;
  prevBoundaryKey?: string;
  remount?: boolean;
  propsMatchSessionUnits?: boolean;
};

function tracingEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEBUG_SECTION_TRANSITION === "0") return false;
  if (process.env.NEXT_PUBLIC_DEBUG_SECTION_TRANSITION === "1") return true;
  if (process.env.DEBUG_SECTION_TRANSITION === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function logSectionTransition(payload: SectionTransitionTrace): void {
  if (!tracingEnabled()) return;
  console.info("[section-transition]", JSON.stringify(payload));
}

export function flattenLearningUnitPartIds(
  units: readonly { parts: readonly { id: string }[] }[],
): string[] {
  return units.flatMap((unit) => unit.parts.map((part) => part.id));
}

/**
 * Query used when LearnPageContent rejects a locked section.
 * Kept here so the investigation can assert the production branch without
 * depending on a live browser.
 */
export function lockedSectionRedirectQuery(input: {
  requestedSectionIndex: number;
  highestUnlockedSection: number;
}): { summary: "1" } | { step: "1" } {
  return input.highestUnlockedSection < input.requestedSectionIndex
    ? { summary: "1" }
    : { step: "1" };
}
