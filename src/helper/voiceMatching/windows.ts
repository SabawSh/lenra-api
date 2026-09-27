import { tokenizeTileText } from "./textUtils";
import type { SpeechWindow } from "./types";

export function windowSizesForTile(tileTokenCount: number): number[] {
  const sizes = new Set<number>();

  sizes.add(Math.max(1, tileTokenCount - 1));
  sizes.add(tileTokenCount);

  if (tileTokenCount <= 8) {
    sizes.add(tileTokenCount + 1);
    sizes.add(tileTokenCount + 2);
  }

  return [...sizes].sort((a, b) => a - b);
}

export function generateSlidingWindows(
  transcriptTokens: readonly string[],
  tileTokenCount: number,
  indexOffset = 0,
): SpeechWindow[] {
  if (transcriptTokens.length === 0 || tileTokenCount <= 0) return [];

  const windows: SpeechWindow[] = [];
  for (const size of windowSizesForTile(tileTokenCount)) {
    for (let start = 0; start <= transcriptTokens.length - size; start++) {
      const end = start + size - 1 + indexOffset;
      const tokens = Array.from(
        { length: size },
        (_, index) => transcriptTokens[start + index] ?? "",
      );
      windows.push({
        start: start + indexOffset,
        end,
        tokens,
      });
    }
  }

  return windows;
}

export function tileTokenCountFromText(text: string): number {
  return tokenizeTileText(text).length;
}
