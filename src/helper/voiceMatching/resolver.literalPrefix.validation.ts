/**
 * Resolver longest-literal-prefix regression — run with:
 *   npx tsx helper/voiceMatching/resolver.literalPrefix.validation.ts
 */
import { gateMatchEvidenceTier, buildCandidateScoring } from "./evidenceTier";
import {
  isStrictSpanPrefix,
  makeVoiceCandidate,
  resolveVoiceCandidates,
  suppressLiteralPrefixCandidates,
} from "./resolver";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function literalCandidate(
  tileId: string,
  text: string,
  start: number,
  end: number,
  scoreBoost = 0,
) {
  const gateTier = gateMatchEvidenceTier({
    tileText: text,
    windowTokens: text.split(" "),
    allEvidenceExact: true,
  });
  const scoring = buildCandidateScoring({
    acceptReason: "GATE_MATCH",
    gateMatchTier: gateTier,
    pronunciationScore: 1,
  });
  return makeVoiceCandidate({
    tileId,
    span: { start, end },
    acceptReason: "GATE_MATCH",
    evidenceTier: scoring.evidenceTier,
    tierLabel: scoring.tierLabel,
    score: scoring.score + scoreBoost,
    scoreComponents: scoring.scoreComponents,
  });
}

function resolvePair(shortText: string, longText: string) {
  const shortTokens = shortText.split(" ");
  const longTokens = longText.split(" ");
  // Give the shorter candidate a higher score so prefix rule must override score.
  const shortHigh = literalCandidate(
    "short",
    shortText,
    0,
    shortTokens.length - 1,
    50,
  );
  const longer = literalCandidate("long", longText, 0, longTokens.length - 1);

  assert(
    isStrictSpanPrefix(shortHigh.span, longer.span),
    `${shortText} must be a strict span prefix of ${longText}`,
  );

  const resolution = resolveVoiceCandidates({
    candidates: [shortHigh, longer],
    commitmentLevel: "final",
  });

  const winnerIds = resolution.winners.map((winner) => winner.tileId);
  const suppressedIds = resolution.suppressed.map((row) => row.tileId);

  assert(
    winnerIds.length === 1 && winnerIds[0] === "long",
    `expected only longer "${longText}" to win, got winners=${winnerIds.join(",")}`,
  );
  assert(
    suppressedIds.includes("short"),
    `expected shorter "${shortText}" to be suppressed`,
  );
  assert(
    resolution.suppressed.some(
      (row) =>
        row.tileId === "short" &&
        row.suppressionReason === "LITERAL_PREFIX_SUBSUMED",
    ),
    `expected LITERAL_PREFIX_SUBSUMED for "${shortText}"`,
  );

  const prefixPass = suppressLiteralPrefixCandidates([shortHigh, longer]);
  assert(
    prefixPass.kept.length === 1 && prefixPass.kept[0]!.tileId === "long",
    "prefix pass should keep only the longer literal",
  );
}

function main(): void {
  const cases: Array<[string, string]> = [
    ["I", "I almost"],
    ["go", "go home"],
    ["he", "he said"],
    ["you", "you would"],
  ];

  for (const [shorter, longer] of cases) {
    resolvePair(shorter, longer);
  }

  // Non-prefix same-start should not use this rule (different starts / no prefix).
  const a = literalCandidate("a", "home", 1, 1);
  const b = literalCandidate("b", "go home", 0, 1);
  const pass = suppressLiteralPrefixCandidates([a, b]);
  assert(pass.suppressed.length === 0, "non-prefix pair must not be subsumed");

  console.log("resolver.literalPrefix.validation: OK");
}

main();
