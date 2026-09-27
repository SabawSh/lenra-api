# Voice Matching Architecture (v2)

This directory answers one question, deterministically and explainably:

> Which puzzle tiles did the learner intend to speak, and why?

It is a **constrained matcher** (tiles already exist in the puzzle), not dictation
or subtitle generation.

## Pipeline

```
Transcript tokens
        ↓
Candidate Generation (matchVoiceTiles / evaluateTile)
        ↓
Literal span refinement
        ↓
Conflict Graph (buildConflictGraph)
        ↓
Resolver (resolveVoiceCandidates) — sole semantic owner
        ↓
Placement (appendPlacements) — sticky commit only
        ↓
UI snapshot
```

## Ownership (single owner per decision)

| Decision | Owner |
|----------|-------|
| Could this tile match this span? | `evaluateTile` → `VoiceCandidate` |
| Who owns overlapping spans? | `resolver.ts` |
| Sticky commit / `commitSeq` | `sessionPlacementState.ts` |
| What does the user see? | `uiFinalSnapshot.ts` renders **exactly** placement output |

`matchVoiceTiles` generates **candidates only** — it never emits semantic ACCEPT.
The **Resolver** emits winners; `acceptedTiles` in `MatchVoiceTilesResult` mirrors
resolver winners for backward compatibility.

Placement **never** compares competing hypotheses (`compareAppendPriority` removed).
Resolver proposals must be conflict-free; placement asserts this in development.

## Evidence tiers

| Tier | Source | Nature |
|------|--------|--------|
| T1 | Exact lexical (`GATE_MATCH`) | Hard |
| T2 | Validated variant (`GATE_MATCH`) | Hard |
| T3 | Phrase knowledge | Semi-hard |
| T4 | Phrase similarity | Soft |
| T5 | Pronunciation rescue | Softest |

Soft evidence (T4/T5) cannot win tokens **hard-owned** by T1/T2 on the conflict graph.

## Purity

`matchVoiceTiles` + `resolveVoiceCandidates` are pure functions of their arguments:

- transcript, unsolved tiles, consumed spans (sticky locks)
- injected phrase knowledge, token lexicon
- commitment level (`preview` | `final`)

No React, no global reads, no side effects in the matcher/resolver core.

## Module map

| File | Role |
|------|------|
| `matchVoiceTiles.ts` | Candidate generation + resolver orchestration |
| `evaluateTile.ts` | Per-tile candidate extraction |
| `candidateTypes.ts` | Candidate, tier, resolution types |
| `evidenceTier.ts` | Tier assignment + scoring |
| `conflictGraph.ts` | Overlap / hard-ownership graph |
| `resolver.ts` | Exclusive winner selection + explainability |
| `literalSpanRefinement.ts` | Literal span correction before resolver |
| `decisionEngine.ts` | Soft evidence scoring (phrase/knowledge) |
| `placementBridge.ts` | Knowledge inject + proposals adapter |
| `sessionPlacementState.ts` | Sticky append-only commit |

## Validation

```bash
npm run test:voice            # all voice suites
npm run test:voice-match      # matcher + resolver + RCA near-pairs
npm run test:builder-session  # placement/render invariants
npm run speech:replay         # streaming / sticky replay
```

## Architectural invariants

- One transcript token → at most one semantic winner per resolver pass
- One tile instance → at most one winner per pass
- No overlapping winners after resolver
- Placement never uses `tileId` to decide meaning
- Hard evidence dominates soft on shared tokens
