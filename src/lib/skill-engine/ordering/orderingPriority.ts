import type { PartState } from "@/lib/skill-engine/domain/types";

/**
 * Remediation-first sort key (lower = earlier in section).
 * struggle → unknown → review → mastered
 */
export function orderingPriority(state: PartState): number {
  switch (state) {
    case "struggle":
      return 0;
    case "unknown":
      return 1;
    case "review":
      return 2;
    case "mastered":
      return 3;
  }
}
