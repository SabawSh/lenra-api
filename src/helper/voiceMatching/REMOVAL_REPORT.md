# Voice Matching Legacy Removal Report

Hard reset completed. All prior voice-matching generations removed.

## Deleted directories

| Directory | Contents |
|-----------|----------|
| `helper/voiceMatchingV2/` | Shadow matcher V2 (21 files): ranking, promotion, shadow collector |
| `helper/voiceMatchingV3/` | Shadow matcher V3 (21 files): promotion, replay, comparison |
| `helper/voiceDataset/` | Observability layer (13 files): collectors, analytics, labeling |

## Deleted `helper/puzzel/` voice files

- `voicePlacementOrchestrator.ts` — multi-engine orchestration chain
- `matchPuzzleFromTranscript.ts` — strict/semantic matcher (V1)
- `realtimeSpeechPlacementEngine.ts` — incremental realtime matcher
- `softMatchVoiceLayer.ts` — phonetic fallback layer
- `phoneticIntentRecovery.ts` — phonetic intent engine
- `phoneticDistanceRecovery.ts` — phonetic distance engine
- `voicePlacementConflictResolver.ts` — candidate competition + overlap rejection
- `buildVoicePipelineTrace.ts` — trace builder
- `voicePipelineTrace.ts` — pipeline trace types
- `voicePipelineDebug.ts` — debug logging
- `voiceMatchTrace.ts` — end-to-end trace logger
- `voiceMatchDebug.ts` — debug flag
- `phoneticIntentFalsePositiveTrace.ts` — false-positive diagnostics
- `realtimeSpeechPlacementDebug.ts` — realtime debug
- `softMatchVoiceDebug.ts` — soft override debug
- All corresponding `.validation.ts` files

## Deleted `helper/speech/` voice-matching files

- `captionPhoneticRecovery.ts` — caption-constrained transcript rewriting
- `semanticTokenStream.ts` — semantic token enrichment
- `semanticTokenMatching.ts` — stream-to-tile alignment
- `sttTokenMatching.ts` — STT token similarity + phrase alignment
- `closestPhoneticCandidate.ts` — phonetic scoring + puzzle context
- `phoneticEquivalenceLayer.ts` — contraction/variant merging for matching
- `phoneticEvidenceGate.ts` — phonetic recovery gate
- `contractionMatchTrace.ts` — contraction debug trace
- `matcher.ts` — orphaned simple matcher
- `speechRecognition.ts` — orphaned
- All corresponding `.validation.ts` files

## Deleted UI / docs

- `components/dev/VoiceMatchingV2Dashboard.tsx`
- `components/dev/VoiceMatchingV3Dashboard.tsx`
- `components/dev/VoiceDatasetReviewPanel.tsx`
- `SPEECH-ROADMAP.md`

## Preserved utilities

| File | Reason |
|------|--------|
| `helper/speech/normalizer.ts` | Token normalization |
| `helper/speech/tokenizer.ts` | Transcript tokenization |
| `helper/speech/phoneticDistance.ts` | Phonetic similarity |
| `helper/speech/mergeTranscriptWithOverlap.ts` | STT chunk merge (UI) |
| `helper/speech/tokenOccurrenceTracker.ts` | Consumed-token tracking |
| `helper/speech/specificNames.ts` | Name utilities (dictionary) |
| `helper/speech/engines/` | STT adapters |
| `helper/puzzel/sessionPlacementState.ts` | Simplified — placement state only |
| `helper/puzzel/orderValidation.ts` | Simplified — order checking only |

## Integration changes

| File | Change |
|------|--------|
| `components/molecules/sentenceBuilder.tsx` | Uses `helper/voiceMatching` orchestrator; removed shadow collectors, dataset, trace, transcript rewriting |
| `app/[locale]/(learning)/layout.tsx` | Removed dev dashboards |
| `components/organisms/videoLearningPlayer.tsx` | Removed `voiceDatasetContext` prop |
| `package.json` | `test:voice-match` points to new validation suite |

## New architecture

`helper/voiceMatching/` — 14 files replacing ~75 legacy files across 3 generations.
