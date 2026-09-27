import { PuzzlePart } from "@/types/puzzle";
import { normalizeText } from "@/helper/speech/normalizer";

export type OrderValidationResult = "incomplete" | "wrong-order" | "correct";

export type OrderValidationDetail = {
  status: OrderValidationResult;
  firstWrongIndex: number | null;
};

export function validateOrderWithDetail(
  selected: PuzzlePart[],
  original: PuzzlePart[],
): OrderValidationDetail {
  if (selected.length === 0) {
    return { status: "incomplete", firstWrongIndex: null };
  }

  for (let index = 0; index < selected.length; index++) {
    if (!original[index] || selected[index].id !== original[index].id) {
      return {
        status: "wrong-order",
        firstWrongIndex: index,
      };
    }
  }

  if (selected.length === original.length) {
    return { status: "correct", firstWrongIndex: null };
  }

  return { status: "incomplete", firstWrongIndex: null };
}

export function repairDuplicateTextSlotOrder(
  selected: PuzzlePart[],
  original: PuzzlePart[],
): PuzzlePart[] | null {
  if (selected.length !== original.length || original.length === 0) return null;

  for (let index = 0; index < original.length; index++) {
    if (
      normalizeText(selected[index]?.text ?? "") !==
      normalizeText(original[index]?.text ?? "")
    ) {
      return null;
    }
  }

  const byId = new Map(selected.map((part) => [part.id, part]));
  const repaired: PuzzlePart[] = [];
  for (const originalPart of original) {
    const part = byId.get(originalPart.id);
    if (!part) return null;
    repaired.push(part);
  }
  return repaired;
}
