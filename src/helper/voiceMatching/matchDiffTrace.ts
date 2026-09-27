/**
 * Matcher / placement acceptance diff probe — debug-gated.
 * Enable: NEXT_PUBLIC_STT_DEBUG=1 | NEXT_PUBLIC_STT_FALLBACK_DEBUG=1 | VOICE_MATCH_DEBUG=1
 */
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import { placementOrderTraceEnabled } from "./placementOrderTrace";

export function matchDiffTraceEnabled(): boolean {
  return placementOrderTraceEnabled() || resolveSttFallbackConfig().debug;
}

export type MatchDiffTile = {
  tileId: string;
  tileText: string;
  speechStart?: number;
  speechEnd?: number;
  detached?: boolean;
};

export type MatchDiffRemovalReason =
  | "PREPARE_PRIOR_DROPPED_FALSE_LOCK"
  | "PREPARE_PRIOR_DETACHED_WORDS_GONE"
  | "PREPARE_PRIOR_MISSING_AFTER_REPAIR"
  | "APPEND_EVICTED_LITERAL_PREFIX"
  | "APPEND_UNKNOWN_DROP"
  | "TRANSCRIPT_NO_LONGER_CONTAINS_TILE"
  | "UNKNOWN";

export function logMatchDiff(lines: readonly string[]): void {
  if (!matchDiffTraceEnabled()) return;
  // eslint-disable-next-line no-console -- intentional match-diff probe
  console.log(["[MATCH-DIFF]", ...lines].join("\n"));
}

export function formatMatchDiffTiles(tiles: readonly MatchDiffTile[]): string {
  if (tiles.length === 0) return "(none)";
  return tiles
    .map((tile) => {
      const span =
        tile.speechStart === undefined
          ? ""
          : ` [${tile.speechStart}-${tile.speechEnd ?? tile.speechStart}]`;
      const det = tile.detached ? " DETACHED" : "";
      return `  - ${tile.tileText} (${tile.tileId})${span}${det}`;
    })
    .join("\n");
}
