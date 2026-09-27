/**
 * Observe-only: reproduce "hovered" PLACED → REMOVED via real snapshot pipeline.
 *   VOICE_MATCH_DEBUG=1 npx tsx helper/puzzel/hoveredTileLifecycle.diagnosis.ts
 */
import { buildUiFinalSnapshot } from "./uiFinalSnapshot";
import { createEmptySessionPlacementState } from "./sessionPlacementState";
import type { PuzzlePart } from "@/types/puzzle";

const hovered: PuzzlePart = {
  id: "tile-hovered",
  text: "hovered",
  tokens: ["hovered"],
};

const filler: PuzzlePart = {
  id: "tile-over",
  text: "over",
  tokens: ["over"],
};

const originalParts = [hovered, filler];
const tileTextById = new Map(originalParts.map((p) => [p.id, p.text]));

function snap(
  label: string,
  transcriptTokens: string[],
  prior: ReturnType<typeof createEmptySessionPlacementState>,
  commitmentLevel: "preview" | "final",
) {
  console.log(`\n======== ${label} (${commitmentLevel}) transcript=[${transcriptTokens.join(" ")}] ========`);
  const result = buildUiFinalSnapshot({
    sessionId: "diag",
    utteranceKey: `${label}:${transcriptTokens.join(" ")}`,
    transcriptTokens,
    voicePool: originalParts.filter(
      (p) => !prior.placedTiles.has(p.id),
    ),
    originalParts,
    tileTextById,
    priorPlacement: prior,
    commitmentLevel,
  });
  const entry = result.placementState.placedTiles.get("tile-hovered");
  console.log(
    `RESULT placedTiles.has(hovered)=${!!entry} ` +
      (entry
        ? `commitSeq=${entry.commitSeq} span=[${entry.matchedSpan.start},${entry.matchedSpan.end}]`
        : ""),
  );
  console.log(
    `RESULT orderedTiles=${result.snapshot.orderedTiles.map((t) => t.text).join("|") || "(none)"}`,
  );
  return result.placementState;
}

process.env.VOICE_MATCH_DEBUG = "1";

let placement = createEmptySessionPlacementState();

// 1) Interim places "hovered"
placement = snap("1-place", ["hovered"], placement, "preview");

// 2) Weak interim rewrite — single-token cannot prefix-hold → detach (still sticky)
placement = snap("2-weak-interim", ["hover"], placement, "preview");

// 3) Final while still detached — purge removes
placement = snap("3-final-purge", ["hover"], placement, "final");

// 4) Stronger words return after purge — must rematch (new sticky), proves no recover-from-detach
placement = snap("4-words-return", ["hovered"], placement, "preview");

console.log("\nhoveredTileLifecycle.diagnosis: done\n");
