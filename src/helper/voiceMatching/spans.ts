import type { ConsumedSpan, MatchedSpan, SpeechWindow } from "./types";

export function spansOverlap(
  left: ConsumedSpan | MatchedSpan,
  right: ConsumedSpan | MatchedSpan,
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

export function windowOverlapsConsumedSpan(
  window: SpeechWindow,
  consumedSpans: readonly ConsumedSpan[],
): boolean {
  return consumedSpans.some((span) => spansOverlap(span, window));
}

/**
 * Hard reservation: any overlap with a consumed span blocks the window.
 * No prefix-upgrade path — append-only placement never reopens reserved spans.
 */
export function windowBlockedByConsumedSpan(
  window: SpeechWindow,
  consumedSpans: readonly ConsumedSpan[],
  _tileTokenCount?: number,
): {
  blocked: boolean;
  upgradeOverSpan: ConsumedSpan | null;
} {
  for (const span of consumedSpans) {
    if (spansOverlap(span, window)) {
      return { blocked: true, upgradeOverSpan: null };
    }
  }
  return { blocked: false, upgradeOverSpan: null };
}
