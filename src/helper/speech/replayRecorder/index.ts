export type {
  ProductionSpeechSessionMeta,
  ProductionSpeechRecordedEvent,
  ProductionSpeechFailureFlags,
  ProductionSpeechRecording,
  ReplayRecorderEngine,
  RecordedCommitmentLevel,
} from "./types";

export {
  getSpeechPipelineVersionSnapshot,
  SPEECH_PIPELINE_VERSION,
  SPEECH_CAPTION_VERSION,
  SPEECH_ADAPTIVE_TEACHER_VERSION,
  SPEECH_LEXICON_VERSION,
  SPEECH_NORMALIZER_VERSION,
  SPEECH_MATCHER_VERSION,
  SPEECH_PLACEMENT_VERSION,
  type SpeechPipelineVersionSnapshot,
} from "./speechPipelineVersions";

export {
  getSpeechConfigSnapshot,
  getCurrentPipelineFingerprint,
  fingerprintSpeechConfigSnapshot,
  stableStringify,
  type SpeechConfigSnapshot,
} from "./speechConfigSnapshot";

export {
  createReplayRecorder,
  AUTO_PAUSE_GAP_MS,
  type ReplayRecorder,
  type StartReplayRecorderInput,
} from "./createReplayRecorder";

export {
  exportReplaySession,
  exportReplaySessionJson,
  recordedEventsToReplayEvents,
  type ExportReplayOptions,
} from "./exportReplay";

export type { ReplayFixture, ReplayFixtureMeta } from "./replayFixture";

export {
  recordingMatchesFailureFilter,
  filterFailedRecordings,
  type FailureExportFilter,
} from "./failureFilters";

export {
  saveProductionSpeechRecording,
  listProductionSpeechRecordings,
  getProductionSpeechRecording,
  listFailedProductionSpeechRecordings,
  clearProductionSpeechRecordings,
  setReplayRecordingStoreCapacity,
} from "./store";

export {
  downloadReplayFixture,
  downloadReplay,
  downloadLastSession,
  downloadLastFailed,
  listRecordedSessions,
  installReplayRecorderWindowApi,
  type ReplayDownloadResult,
  type LenraSpeechReplayWindowApi,
} from "./clientExport";
