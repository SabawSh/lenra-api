export type UtteranceSnapshotLog = {
  snapshotNumber: number;
  transcript?: string;
  bytes: number;
  durationMs?: number;
  recorderRestarted: boolean;
};

export type UtteranceSnapshotUploadLog = {
  snapshotNumber: number;
  snapshotTranscript?: string;
  retryTriggerSource: "onTranscript" | "finalizeListening";
  retryTranscript: string;
  bytes: number;
  durationMs?: number;
  reusedExistingRetry: boolean;
};

export function logUtteranceSnapshot(log: UtteranceSnapshotLog): void {
}

export function logUtteranceSnapshotUpload(log: UtteranceSnapshotUploadLog): void {
}
