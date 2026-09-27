/**
 * Browser helper: download a production recording as a speech:replay fixture.
 * No server upload — the user saves JSON into tests/speech-replay/sessions/.
 */
import {
  exportReplaySession,
  exportReplaySessionJson,
  type ExportReplayOptions,
} from "./exportReplay";
import type { FailureExportFilter } from "./failureFilters";
import type { ProductionSpeechRecording } from "./types";
import {
  getProductionSpeechRecording,
  listFailedProductionSpeechRecordings,
  listProductionSpeechRecordings,
} from "./store";
import {
  getSpeechChainTrace,
  markSpeechChainExport,
  pushSpeechChainTrace,
} from "@/helper/speech/speechChainTrace";

export type ReplayDownloadResult = {
  sessionId: string;
  filename: string;
  eventCount: number;
  failureFilter?: FailureExportFilter;
};

function defaultGoldOptions(
  recording: ProductionSpeechRecording,
  options: ExportReplayOptions = {},
): ExportReplayOptions {
  return {
    knownFailure: true,
    ...options,
    expectedAcceptedTileIds:
      options.expectedAcceptedTileIds ??
      recording.meta.tiles.map((tile) => tile.id),
    expectedFinalSentence:
      options.expectedFinalSentence ??
      recording.meta.tiles.map((tile) => tile.text).join(" "),
  };
}

export function downloadReplayFixture(
  recording: ProductionSpeechRecording,
  options: ExportReplayOptions = {},
): ReplayDownloadResult {
  if (typeof document === "undefined") {
    throw new Error("downloadReplayFixture requires a browser document");
  }
  const merged = defaultGoldOptions(recording, options);
  const fixture = exportReplaySession(recording, merged);
  const written = fixture.events.map((event, index) => ({
    exportEventIndex: index,
    t: event.t,
    type: event.type,
    transcript:
      "transcript" in event && typeof event.transcript === "string"
        ? event.transcript
        : "",
    isFinal: "isFinal" in event ? event.isFinal === true : undefined,
  }));
  pushSpeechChainTrace(
    "export_written",
    {
      sessionId: fixture.sessionId,
      eventCount: written.length,
      events: written,
      recordingEventCount: recording.events.length,
      chainTraceEntries: getSpeechChainTrace().length,
    },
    [
      "EXPORT downloadReplay — events written to JSON:",
      ...written.map(
        (row) =>
          `  [#${row.exportEventIndex} t=${row.t} ${row.type}] ${JSON.stringify(row.transcript)}`,
      ),
      `(recording had ${recording.events.length} events; chain-trace buffer ${getSpeechChainTrace().length} rows)`,
      `Tip: window.__lenraSpeechChainTrace.find("I'm") or .dump()`,
    ],
  );
  markSpeechChainExport(written);
  const json = `${JSON.stringify(fixture, null, 2)}\n`;
  const filename = `${recording.meta.sessionId}.json`;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return {
    sessionId: recording.meta.sessionId,
    filename,
    eventCount: recording.events.length,
  };
}

export function listRecordedSessions(): readonly ProductionSpeechRecording[] {
  return listProductionSpeechRecordings();
}

export function downloadReplay(
  sessionId: string,
  options?: ExportReplayOptions,
): ReplayDownloadResult {
  const recording = getProductionSpeechRecording(sessionId);
  if (!recording) throw new Error(`No recording ${sessionId}`);
  return downloadReplayFixture(recording, options);
}

export function downloadLastSession(
  options?: ExportReplayOptions,
): ReplayDownloadResult {
  const all = listProductionSpeechRecordings();
  const last = all[all.length - 1];
  if (!last) throw new Error("No recorded sessions in memory");
  return downloadReplayFixture(last, options);
}

export function downloadLastFailed(
  filter: FailureExportFilter = "any_failure",
  options?: ExportReplayOptions,
): ReplayDownloadResult {
  const failed = listFailedProductionSpeechRecordings(filter);
  const last = failed[failed.length - 1];
  if (!last) throw new Error("No failed recordings in memory");
  return downloadReplayFixture(last, {
    knownFailure: true,
    ...options,
  });
}

export type LenraSpeechReplayWindowApi = {
  list: () => Promise<readonly ProductionSpeechRecording[]>;
  listRecordedSessions: () => Promise<readonly ProductionSpeechRecording[]>;
  listFailed: (
    filter?: FailureExportFilter,
  ) => Promise<ProductionSpeechRecording[]>;
  exportJson: (
    sessionId: string,
    options?: ExportReplayOptions,
  ) => Promise<string>;
  download: (
    sessionId: string,
    options?: ExportReplayOptions,
  ) => Promise<ReplayDownloadResult>;
  downloadReplay: (
    sessionId: string,
    options?: ExportReplayOptions,
  ) => Promise<ReplayDownloadResult>;
  downloadLastSession: (
    options?: ExportReplayOptions,
  ) => Promise<ReplayDownloadResult>;
  downloadLastFailed: (
    filter?: FailureExportFilter,
  ) => Promise<ReplayDownloadResult>;
};

/** Attach debug helpers on window for ops / support (optional). */
export function installReplayRecorderWindowApi(): void {
  if (typeof window === "undefined") return;
  const api: LenraSpeechReplayWindowApi = {
    list: async () => listRecordedSessions(),
    listRecordedSessions: async () => listRecordedSessions(),
    listFailed: async (filter) =>
      listFailedProductionSpeechRecordings(filter ?? "any_failure"),
    exportJson: async (sessionId, options) => {
      const recording = getProductionSpeechRecording(sessionId);
      if (!recording) throw new Error(`No recording ${sessionId}`);
      return exportReplaySessionJson(recording, options);
    },
    download: async (sessionId, options) => downloadReplay(sessionId, options),
    downloadReplay: async (sessionId, options) =>
      downloadReplay(sessionId, options),
    downloadLastSession: async (options) => downloadLastSession(options),
    downloadLastFailed: async (filter) => downloadLastFailed(filter),
  };
  (
    window as unknown as { __lenraSpeechReplay?: LenraSpeechReplayWindowApi }
  ).__lenraSpeechReplay = api;
}
