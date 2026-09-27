/**
 * Observe-only lifecycle for tile "Who ever laid".
 *   VOICE_MATCH_DEBUG=1 npx tsx helper/puzzel/whoEverLaidLifecycle.diagnosis.ts
 */
process.env.VOICE_MATCH_DEBUG = "1";

import { buildUiFinalSnapshot } from "./uiFinalSnapshot";
import { createEmptySessionPlacementState } from "./sessionPlacementState";
import type { PuzzlePart } from "@/types/puzzle";

const parts: PuzzlePart[] = [
  { id: "laid", text: "Who ever laid", tokens: ["who", "ever", "laid"] },
  { id: "eyes", text: "their eyes", tokens: ["their", "eyes"] },
  { id: "coral", text: "on Coraline", tokens: ["on", "coraline"] },
];
const tileTextById = new Map(parts.map((p) => [p.id, p.text]));

function run(
  label: string,
  tokens: string[],
  prior: ReturnType<typeof createEmptySessionPlacementState>,
  commitmentLevel: "preview" | "final",
) {
  console.log(`\n======== ${label} (${commitmentLevel}) ========`);
  const beforeVisible = prior.placedTiles.has("laid");
  const result = buildUiFinalSnapshot({
    sessionId: "diag",
    utteranceKey: `${label}:${tokens.join(" ")}:${Math.random()}`,
    transcriptTokens: tokens,
    voicePool: parts,
    originalParts: parts,
    tileTextById,
    priorPlacement: prior,
    commitmentLevel,
  });
  const afterVisible = result.snapshot.orderedTiles.some((t) => t.id === "laid");
  console.log(
    `SUMMARY VISIBLE=${afterVisible} ordered=${result.snapshot.orderedTiles.map((t) => t.text).join(" | ") || "(none)"}`,
  );
  if (beforeVisible && !afterVisible) {
    console.log(
      `>>> FIRST VISIBLE→NOT VISIBLE on this pass (${commitmentLevel}) <<<`,
    );
  }
  return result.placementState;
}

let placement = createEmptySessionPlacementState();

// Matches live Chrome: split interim places tile, then compound final / rewrite.
placement = run("1-place", ["who", "ever", "laid"], placement, "preview");
placement = run("2-compound-final", ["whoever", "laid"], placement, "final");
placement = run(
  "3-eyes",
  ["whoever", "laid", "their", "eyes"],
  placement,
  "preview",
);
placement = run(
  "4-full",
  ["whoever", "laid", "their", "eyes", "on", "coraline"],
  placement,
  "preview",
);

console.log("\nwhoEverLaidLifecycle.diagnosis: done\n");
