/**
 * Single-tile lifecycle probe (observe-only).
 * Watches tile text "Who ever laid" for accept/remove flicker diagnosis.
 * Enable: NEXT_PUBLIC_STT_DEBUG=1 | NEXT_PUBLIC_STT_FALLBACK_DEBUG=1 | VOICE_MATCH_DEBUG=1
 */
import { normalizeText } from "@/helper/speech/normalizer";
import { placementOrderTraceEnabled } from "./placementOrderTrace";

/** Exact tile text under investigation (normalized). */
export const LIFECYCLE_WATCH_TILE_TEXT = "who ever laid";

export function tileLifecycleTraceEnabled(): boolean {
  return placementOrderTraceEnabled();
}

export function isLifecycleWatchTileText(tileText: string | undefined): boolean {
  if (!tileText) return false;
  return normalizeText(tileText) === LIFECYCLE_WATCH_TILE_TEXT;
}

export type TileLifecycleAttachment = "attached" | "detached" | "absent";

type LifecycleSpan = { start: number; end: number };

export type TileLifecycleEvent = {
  phase: string;
  functionName: string;
  reason: string;
  tileId?: string;
  tileText?: string;
  commitSeq?: number | null;
  attachment: TileLifecycleAttachment;
  commitmentLevel?: string;
  transcript?: string;
  literalSpan?: LifecycleSpan | null;
  matchedSpan?: LifecycleSpan | null;
  matchedTokenIndices?: readonly number[] | null;
  extras?: readonly string[];
};

function formatSpan(span: LifecycleSpan | null | undefined): string {
  if (span == null) return "n/a";
  return `[${span.start},${span.end}]`;
}

export function logTileLifecycle(event: TileLifecycleEvent): void {
  if (!tileLifecycleTraceEnabled()) return;
  if (
    event.tileText != null &&
    !isLifecycleWatchTileText(event.tileText) &&
    event.attachment !== "absent"
  ) {
    return;
  }
  if (
    event.tileText == null &&
    event.phase !== "watch-miss" &&
    !event.reason.toLowerCase().includes("who ever laid")
  ) {
    return;
  }

  const lines = [
    "[TILE-LIFECYCLE]",
    `phase: ${event.phase}`,
    `function: ${event.functionName}`,
    `reason: ${event.reason}`,
    `tileId: ${event.tileId ?? "n/a"}`,
    `tileText: ${event.tileText ?? "n/a"}`,
    `commitSeq: ${event.commitSeq ?? "n/a"}`,
    `attached/detached: ${event.attachment}`,
    `commitmentLevel: ${event.commitmentLevel ?? "n/a"}`,
    `transcript: ${event.transcript ?? "n/a"}`,
    `literalSpan: ${formatSpan(event.literalSpan)}`,
    `matchedSpan: ${formatSpan(event.matchedSpan)}`,
    `matchedTokenIndices: ${
      event.matchedTokenIndices == null
        ? "n/a"
        : JSON.stringify(event.matchedTokenIndices)
    }`,
  ];
  if (event.extras) {
    for (const line of event.extras) lines.push(line);
  }
  // eslint-disable-next-line no-console -- intentional tile lifecycle probe
  console.log(lines.join("\n"));
}
