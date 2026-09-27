/**
 * Convert a production flight recording into a ReplaySession JSON
 * accepted by `npm run speech:replay` — no manual transcript rewriting.
 */
import type { SpeechReplayEvent } from "@/helper/speech/voiceSession";
import type { ReplayFixture } from "./replayFixture";
import {
  getCurrentPipelineFingerprint,
  getSpeechConfigSnapshot,
} from "./speechConfigSnapshot";
import { getSpeechPipelineVersionSnapshot } from "./speechPipelineVersions";
import type { ProductionSpeechRecording } from "./types";

export type ExportReplayOptions = {
  /** Override session id in the fixture (default: recording meta.sessionId). */
  sessionId?: string;
  /**
   * Gold labels for CI. Default: final accepted tiles from the recording
   * (what production actually placed). For incomplete failures, pass the
   * full expected tile ids so the replay FAILs until the bug is fixed, or
   * set knownFailure.
   */
  expectedAcceptedTileIds?: string[];
  expectedOrderedTileIds?: string[];
  expectedFinalSentence?: string;
  knownFailure?: boolean;
  bugRef?: string;
  failureReason?: string;
  notes?: string;
  /** Include session_end as a trailing pause-free marker (default false — not a replay event). */
  includeSessionEndAsPause?: boolean;
};

function failureReasonFromRecording(
  recording: ProductionSpeechRecording,
): string | undefined {
  const flags = recording.failure;
  const reasons: string[] = [];
  if (flags.zeroAcceptedTiles) reasons.push("zero_accepted_tiles");
  if (flags.retryTriggered) reasons.push("retry_triggered");
  if (flags.lowConfidence) reasons.push("low_confidence");
  if (flags.matcherRejectedTranscript) reasons.push("matcher_rejected_transcript");
  if (flags.userAbandoned) reasons.push("user_abandoned");
  if (flags.incompleteVsExpected) reasons.push("incomplete_vs_expected");
  return reasons.length > 0 ? reasons.join(",") : undefined;
}

/**
 * Map recorded production events → SpeechReplayEvent[] for the replay runner.
 * Preserves order, timings, revisions, retries, and auto-detected pauses.
 */
export function recordedEventsToReplayEvents(
  recording: ProductionSpeechRecording,
): SpeechReplayEvent[] {
  const out: SpeechReplayEvent[] = [];
  for (const event of recording.events) {
    if (event.type === "hypothesis") {
      out.push({
        t: event.t,
        type: "hypothesis",
        transcript: event.transcript ?? "",
        isFinal: event.isFinal === true,
        confidence: event.confidence,
      });
      continue;
    }
    if (event.type === "transcript") {
      out.push({
        t: event.t,
        type: "transcript",
        transcript: event.transcript ?? "",
        confidence: event.confidence,
      });
      continue;
    }
    if (event.type === "mic_release") {
      out.push({
        t: event.t,
        type: "mic_release",
        confidence: event.confidence,
      });
      continue;
    }
    if (event.type === "retry_transcript") {
      out.push({
        t: event.t,
        type: "retry_transcript",
        transcript: event.transcript ?? "",
      });
      continue;
    }
    if (event.type === "pause") {
      out.push({
        t: event.t,
        type: "pause",
        durationMs: event.durationMs,
      });
    }
    // session_end is metadata-only for export; not a replay engine event
  }
  return out;
}

/**
 * Export one production recording to a ReplaySession fixture.
 */
export function exportReplaySession(
  recording: ProductionSpeechRecording,
  options: ExportReplayOptions = {},
): ReplayFixture {
  const meta = recording.meta;
  const accepted =
    options.expectedAcceptedTileIds ??
    (recording.finalAcceptedTileIds.length > 0
      ? recording.finalAcceptedTileIds
      : meta.tiles.map((tile) => tile.id));

  const failureReason =
    options.failureReason ?? failureReasonFromRecording(recording);

  const versions = getSpeechPipelineVersionSnapshot(meta.appVersion);
  const speechConfigSnapshot = getSpeechConfigSnapshot();
  const pipelineFingerprint = getCurrentPipelineFingerprint();

  const session: ReplayFixture = {
    sessionId: options.sessionId ?? meta.sessionId,
    description: `Exported from production (${meta.browser}/${meta.engine})`,
    movie: meta.movie,
    caption: meta.caption,
    tiles: meta.tiles.map((tile) => ({ id: tile.id, text: tile.text })),
    events: recordedEventsToReplayEvents(recording),
    expected: {
      acceptedTileIds: accepted,
      orderedTileIds: options.expectedOrderedTileIds ?? accepted,
      finalSentence:
        options.expectedFinalSentence ??
        (recording.finalSentence ||
          meta.tiles.map((tile) => tile.text).join(" ")),
      knownFailure: options.knownFailure,
      bugRef: options.bugRef,
    },
    tags: [
      "createdFrom:production",
      `engine:${meta.engine}`,
      `browser:${meta.browser}`,
      `pipeline:${versions.pipelineVersion}`,
    ],
    notes: options.notes ?? meta.notes,
    meta: {
      id: options.sessionId ?? meta.sessionId,
      createdFrom: "production",
      browser: meta.browser,
      platform: meta.platform,
      engine: meta.engine,
      locale: meta.locale,
      appVersion: versions.appVersion,
      exerciseId: meta.exerciseId,
      captionId: meta.captionId,
      expectedSentence: meta.expectedSentence,
      failureReason,
      startedAt: meta.startedAt,
      endedAt: recording.endedAt,
      notes: options.notes ?? meta.notes,
      pipelineVersion: versions.pipelineVersion,
      gitCommit: versions.gitCommit,
      captionVersion: versions.captionVersion,
      adaptiveTeacherVersion: versions.adaptiveTeacherVersion,
      lexiconVersion: versions.lexiconVersion,
      normalizerVersion: versions.normalizerVersion,
      matcherVersion: versions.matcherVersion,
      placementVersion: versions.placementVersion,
      exportedAt: versions.exportedAt,
      pipelineFingerprint,
      speechConfigSnapshot,
    },
  };

  return session;
}

/** Pretty JSON suitable for dropping into tests/speech-replay/sessions/. */
export function exportReplaySessionJson(
  recording: ProductionSpeechRecording,
  options: ExportReplayOptions = {},
): string {
  return `${JSON.stringify(exportReplaySession(recording, options), null, 2)}\n`;
}
