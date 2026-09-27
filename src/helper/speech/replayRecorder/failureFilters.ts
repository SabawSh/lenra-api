import type { ProductionSpeechRecording } from "./types";

export type FailureExportFilter =
  | "zero_accepted_tiles"
  | "retry_triggered"
  | "low_confidence"
  | "matcher_rejected_transcript"
  | "user_abandoned"
  | "incomplete_vs_expected"
  | "any_failure";

export function recordingMatchesFailureFilter(
  recording: ProductionSpeechRecording,
  filter: FailureExportFilter,
): boolean {
  const f = recording.failure;
  switch (filter) {
    case "zero_accepted_tiles":
      return f.zeroAcceptedTiles;
    case "retry_triggered":
      return f.retryTriggered;
    case "low_confidence":
      return f.lowConfidence;
    case "matcher_rejected_transcript":
      return f.matcherRejectedTranscript;
    case "user_abandoned":
      return f.userAbandoned;
    case "incomplete_vs_expected":
      return f.incompleteVsExpected;
    case "any_failure":
      return (
        f.zeroAcceptedTiles ||
        f.retryTriggered ||
        f.lowConfidence ||
        f.matcherRejectedTranscript ||
        f.userAbandoned ||
        f.incompleteVsExpected
      );
    default:
      return false;
  }
}

export function filterFailedRecordings(
  recordings: readonly ProductionSpeechRecording[],
  filter: FailureExportFilter = "any_failure",
): ProductionSpeechRecording[] {
  return recordings.filter((recording) =>
    recordingMatchesFailureFilter(recording, filter),
  );
}
