import { PuzzlePart } from "@/types/puzzle";

export type PuzzleState = {
  /** Left-to-right build order — what the user said or tapped, no reserved empty slots. */
  selected: PuzzlePart[];
  available: PuzzlePart[];
};

export function applyMatchedChunks(
  state: PuzzleState,
  matched: PuzzlePart[],
): PuzzleState {
  const newSelected = [...state.selected];
  const newAvailable = [...state.available];

  for (const chunk of matched) {
    const idx = newAvailable.findIndex((c) => c.id === chunk.id);
    if (idx !== -1) {
      newSelected.push(chunk);
      newAvailable.splice(idx, 1);
    }
  }

  return {
    selected: newSelected,
    available: newAvailable,
  };
}
