export { matchVoiceTiles } from "./matchVoiceTiles";
export { orchestrateVoicePlacements } from "./placementBridge";
export { resolveVoiceCandidates } from "./resolver";
export {
  isStrictSpanPrefix,
  suppressLiteralPrefixCandidates,
} from "./resolver";
export { buildConflictGraph } from "./conflictGraph";
export {
  buildCaptionVocabulary,
  recoverCaptionVocabulary,
  isOrdinaryPhraseCollapse,
  isEntityBoundaryViolation,
  CAPTION_RECOVERY_MIN_SCORE,
} from "./captionAwareRecovery";
export type {
  CaptionVocabularyEntry,
  CaptionRecoveryReplacement,
  RecoverCaptionVocabularyResult,
} from "./captionAwareRecovery";
export {
  decideTileAcceptance,
  prepareKnowledgeWindowCandidate,
} from "./decisionEngine";
export {
  collectPhraseSimilarityCandidate,
  scorePhraseSimilarity,
  scorePhraseSimilarityForWindow,
} from "./phraseSimilarityEngine";
export {
  resolveVoiceMatchingConfig,
  DEFAULT_VOICE_MATCHING_CONFIG,
  DEFAULT_PHRASE_SIMILARITY_THRESHOLD,
  DEFAULT_PHRASE_KNOWLEDGE_THRESHOLD,
  ADAPTIVE_KNOWLEDGE_ENABLED,
} from "./voiceMatchingConfig";
export type {
  AcceptedTile,
  ConsumedSpan,
  MatchVoiceTilesInput,
  MatchVoiceTilesResult,
  RejectedTile,
  RejectionReason,
  VoiceMatcherConfig,
  VoiceTile,
} from "./types";
export type {
  VoiceCandidate,
  ResolutionPassResult,
  WinnerDecision,
  SuppressedCandidate,
  EvidenceTier,
} from "./candidateTypes";
export type { VoicePlacementInput } from "./placementBridge";
export type {
  DecisionEngineInput,
  DecisionEngineResult,
  DecisionEngineDebugReport,
} from "./decisionEngine";
