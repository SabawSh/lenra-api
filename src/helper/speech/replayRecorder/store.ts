/**
 * In-memory store of recent production speech recordings (client-side).
 * No server upload — export locally / copy JSON into the repo.
 */
import type { ProductionSpeechRecording } from "./types";
import {
  filterFailedRecordings,
  type FailureExportFilter,
} from "./failureFilters";

const DEFAULT_CAPACITY = 50;

let recordings: ProductionSpeechRecording[] = [];
let capacity = DEFAULT_CAPACITY;

export function setReplayRecordingStoreCapacity(next: number): void {
  capacity = Math.max(1, next);
  if (recordings.length > capacity) {
    recordings = recordings.slice(recordings.length - capacity);
  }
}

export function saveProductionSpeechRecording(
  recording: ProductionSpeechRecording,
): void {
  recordings.push(recording);
  if (recordings.length > capacity) {
    recordings = recordings.slice(recordings.length - capacity);
  }
}

export function listProductionSpeechRecordings(): readonly ProductionSpeechRecording[] {
  return recordings;
}

export function getProductionSpeechRecording(
  sessionId: string,
): ProductionSpeechRecording | undefined {
  return recordings.find((entry) => entry.meta.sessionId === sessionId);
}

export function listFailedProductionSpeechRecordings(
  filter: FailureExportFilter = "any_failure",
): ProductionSpeechRecording[] {
  return filterFailedRecordings(recordings, filter);
}

export function clearProductionSpeechRecordings(): void {
  recordings = [];
}
