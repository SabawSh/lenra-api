import { detectSttBrowserLabel } from "@/helper/speech/sttAnalytics";
import type { UiFinalSnapshot } from "@/helper/puzzel/uiFinalSnapshot";
import type { SttRetryReason } from "@/helper/speech/sttDecision";
import { normalizeText } from "@/helper/speech/normalizer";
import { pushSpeechChainTrace } from "@/helper/speech/speechChainTrace";
import type {
  ProductionSpeechFailureFlags,
  ProductionSpeechRecordedEvent,
  ProductionSpeechRecording,
  ProductionSpeechSessionMeta,
  RecordedCommitmentLevel,
  ReplayRecorderEngine,
} from "./types";

/** Shared with pipeline fingerprint — auto pause gap between recorded events. */
export const AUTO_PAUSE_GAP_MS = 400;

export type StartReplayRecorderInput = {
  sessionId?: string;
  caption: string;
  expectedSentence?: string;
  tiles: readonly { id: string; text: string }[];
  engine: ReplayRecorderEngine;
  exerciseId?: string;
  captionId?: string;
  movie?: string;
  appVersion?: string;
  locale?: string;
  browser?: string;
  platform?: string;
  /** Confidence below this marks lowConfidence failure (default 0.55). */
  lowConfidenceThreshold?: number;
  nowMs?: () => number;
};

export type ReplayRecorder = {
  readonly sessionId: string;
  recordHypothesis: (input: {
    transcript: string;
    isFinal: boolean;
    confidence?: number;
    engine?: ReplayRecorderEngine;
    snapshot?: UiFinalSnapshot | null;
    sessionTranscript: string;
    commitmentLevel?: RecordedCommitmentLevel;
    note?: string;
  }) => void;
  recordTranscript: (input: {
    transcript: string;
    confidence?: number;
    engine?: ReplayRecorderEngine;
    snapshot?: UiFinalSnapshot | null;
    sessionTranscript: string;
    commitmentLevel?: RecordedCommitmentLevel;
    note?: string;
  }) => void;
  recordMicRelease: (input: {
    confidence?: number;
    retryTriggered?: boolean;
    retryReason?: SttRetryReason | null;
    snapshot?: UiFinalSnapshot | null;
    sessionTranscript: string;
  }) => void;
  recordRetryTranscript: (input: {
    transcript: string;
    engine?: ReplayRecorderEngine;
    snapshot?: UiFinalSnapshot | null;
    sessionTranscript: string;
    retryReason?: SttRetryReason | null;
  }) => void;
  /** Call when the learner leaves / completes / stops without finishing. */
  endSession: (input?: {
    userAbandoned?: boolean;
    snapshot?: UiFinalSnapshot | null;
    sessionTranscript?: string;
    notes?: string;
  }) => ProductionSpeechRecording;
  getRecording: () => ProductionSpeechRecording;
  isActive: () => boolean;
};

function snapshotFields(snapshot: UiFinalSnapshot | null | undefined): {
  acceptedTileIds: string[];
  orderedTileTexts: string[];
  snapshotUtteranceKey?: string;
} {
  if (!snapshot) {
    return { acceptedTileIds: [], orderedTileTexts: [] };
  }
  return {
    acceptedTileIds: snapshot.acceptedTiles.map((tile) => tile.id),
    orderedTileTexts: snapshot.orderedTiles.map((tile) => tile.text),
    snapshotUtteranceKey: snapshot.utteranceKey,
  };
}

function computeFailureFlags(
  events: readonly ProductionSpeechRecordedEvent[],
  tiles: readonly { id: string }[],
  lowConfidenceThreshold: number,
  userAbandoned: boolean,
): ProductionSpeechFailureFlags {
  const last = events[events.length - 1];
  const accepted = last?.acceptedTileIds ?? [];
  const retryTriggered = events.some(
    (event) =>
      event.retryTriggered === true || event.type === "retry_transcript",
  );
  const lowConfidence = events.some(
    (event) =>
      typeof event.confidence === "number" &&
      event.confidence < lowConfidenceThreshold,
  );
  const hadTranscript = events.some(
    (event) =>
      (event.type === "transcript" || event.type === "hypothesis") &&
      (event.transcript?.trim().length ?? 0) > 0,
  );
  const zeroAcceptedTiles = accepted.length === 0 && hadTranscript;
  const matcherRejectedTranscript =
    zeroAcceptedTiles ||
    events.some(
      (event) =>
        event.type === "transcript" &&
        (event.transcript?.trim().length ?? 0) > 0 &&
        event.acceptedTileIds.length === 0,
    );
  const expectedIds = new Set(tiles.map((tile) => tile.id));
  const incompleteVsExpected =
    tiles.length > 0 &&
    (accepted.length < tiles.length ||
      accepted.some((id) => !expectedIds.has(id)));

  return {
    zeroAcceptedTiles,
    retryTriggered,
    lowConfidence,
    matcherRejectedTranscript,
    userAbandoned,
    incompleteVsExpected,
  };
}

function createSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `prod_${stamp}_${rand}`;
}

/**
 * Create an observe-only flight recorder for one mic session.
 */
export function createReplayRecorder(
  input: StartReplayRecorderInput,
): ReplayRecorder {
  const nowMs = input.nowMs ?? (() => Date.now());
  const wallClockStartMs = nowMs();
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.55;
  const sessionId = input.sessionId ?? createSessionId();

  const meta: ProductionSpeechSessionMeta = {
    sessionId,
    createdFrom: "production",
    browser: input.browser ?? detectSttBrowserLabel(),
    platform:
      input.platform ??
      (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
    locale:
      input.locale ??
      (typeof navigator !== "undefined" ? navigator.language : "en-US"),
    engine: input.engine,
    startedAt: new Date(wallClockStartMs).toISOString(),
    appVersion: input.appVersion ?? "0.1.0",
    exerciseId: input.exerciseId,
    captionId: input.captionId,
    caption: input.caption,
    expectedSentence: input.expectedSentence ?? input.caption,
    tiles: input.tiles.map((tile) => ({ id: tile.id, text: tile.text })),
    movie: input.movie,
  };

  const events: ProductionSpeechRecordedEvent[] = [];
  let active = true;
  let lastEventWallMs = wallClockStartMs;
  let endedRecording: ProductionSpeechRecording | null = null;

  function relativeT(): number {
    return Math.max(0, nowMs() - wallClockStartMs);
  }

  function maybeInsertPause(): void {
    const wall = nowMs();
    const gap = wall - lastEventWallMs;
    // Explicit pause marker when the user (or engine) is silent ≥ AUTO_PAUSE_GAP_MS.
    if (gap >= AUTO_PAUSE_GAP_MS && events.length > 0) {
      const last = events[events.length - 1]!;
      events.push({
        t: relativeT(),
        type: "pause",
        durationMs: gap,
        acceptedTileIds: [...last.acceptedTileIds],
        orderedTileTexts: [...last.orderedTileTexts],
        commitmentLevel: last.commitmentLevel,
        sessionTranscript: last.sessionTranscript,
        note: `auto-pause ${gap}ms`,
      });
    }
    lastEventWallMs = wall;
  }

  function push(event: ProductionSpeechRecordedEvent): boolean {
    if (!active) {
      pushSpeechChainTrace(
        "recorder_skipped_inactive",
        {
          type: event.type,
          transcript: event.transcript ?? "",
          reason: "recorder active=false (session already ended)",
        },
        [
          "RECORDER SKIPPED (inactive)",
          `type=${event.type}`,
          `raw:\n${JSON.stringify(event.transcript ?? "")}`,
        ],
      );
      return false;
    }
    maybeInsertPause();
    events.push(event);
    lastEventWallMs = nowMs();
    return true;
  }

  function buildRecording(userAbandoned: boolean): ProductionSpeechRecording {
    const failure = computeFailureFlags(
      events,
      meta.tiles,
      lowConfidenceThreshold,
      userAbandoned,
    );
    const last = events[events.length - 1];
    return {
      meta,
      events: [...events],
      failure,
      wallClockStartMs,
      endedAt: meta.startedAt && active === false ? new Date(nowMs()).toISOString() : undefined,
      finalAcceptedTileIds: last?.acceptedTileIds ?? [],
      finalSentence: (last?.orderedTileTexts ?? []).join(" "),
    };
  }

  return {
    sessionId,
    recordHypothesis(payload) {
      const snap = snapshotFields(payload.snapshot);
      const event: ProductionSpeechRecordedEvent = {
        t: relativeT(),
        type: "hypothesis",
        transcript: payload.transcript,
        isFinal: payload.isFinal,
        engine: payload.engine ?? meta.engine,
        confidence: payload.confidence,
        acceptedTileIds: snap.acceptedTileIds,
        orderedTileTexts: snap.orderedTileTexts,
        snapshotUtteranceKey: snap.snapshotUtteranceKey,
        commitmentLevel: payload.commitmentLevel ?? "preview",
        sessionTranscript: payload.sessionTranscript,
        note: payload.note,
      };
      const saved = push(event);
      if (saved) {
        const normalized = normalizeText(payload.transcript).trim();
        pushSpeechChainTrace(
          "recorder_saved",
          {
            type: "hypothesis",
            eventIndex: events.length - 1,
            t: event.t,
            raw: payload.transcript,
            normalized,
            isFinal: payload.isFinal === true,
            sessionTranscript: payload.sessionTranscript,
            acceptedTileIds: snap.acceptedTileIds,
            note: payload.note ?? null,
          },
          [
            "RECORDER SAVED",
            `type=hypothesis eventIndex=${events.length - 1} t=${event.t}`,
            `raw:\n${JSON.stringify(payload.transcript)}`,
            `normalized:\n${JSON.stringify(normalized)}`,
          ],
        );
      }
    },
    recordTranscript(payload) {
      const snap = snapshotFields(payload.snapshot);
      const event: ProductionSpeechRecordedEvent = {
        t: relativeT(),
        type: "transcript",
        transcript: payload.transcript,
        engine: payload.engine ?? meta.engine,
        confidence: payload.confidence,
        acceptedTileIds: snap.acceptedTileIds,
        orderedTileTexts: snap.orderedTileTexts,
        snapshotUtteranceKey: snap.snapshotUtteranceKey,
        commitmentLevel: payload.commitmentLevel ?? "final",
        sessionTranscript: payload.sessionTranscript,
        note: payload.note,
      };
      const saved = push(event);
      if (saved) {
        const normalized = normalizeText(payload.transcript).trim();
        pushSpeechChainTrace(
          "recorder_saved",
          {
            type: "transcript",
            eventIndex: events.length - 1,
            t: event.t,
            raw: payload.transcript,
            normalized,
            sessionTranscript: payload.sessionTranscript,
            acceptedTileIds: snap.acceptedTileIds,
            note: payload.note ?? null,
          },
          [
            "RECORDER SAVED",
            `type=transcript eventIndex=${events.length - 1} t=${event.t}`,
            `raw:\n${JSON.stringify(payload.transcript)}`,
            `normalized:\n${JSON.stringify(normalized)}`,
          ],
        );
      }
    },
    recordMicRelease(payload) {
      const snap = snapshotFields(payload.snapshot);
      push({
        t: relativeT(),
        type: "mic_release",
        confidence: payload.confidence,
        engine: meta.engine,
        acceptedTileIds: snap.acceptedTileIds,
        orderedTileTexts: snap.orderedTileTexts,
        snapshotUtteranceKey: snap.snapshotUtteranceKey,
        commitmentLevel: "none",
        sessionTranscript: payload.sessionTranscript,
        retryTriggered: payload.retryTriggered,
        retryReason: payload.retryReason ?? null,
      });
    },
    recordRetryTranscript(payload) {
      const snap = snapshotFields(payload.snapshot);
      push({
        t: relativeT(),
        type: "retry_transcript",
        transcript: payload.transcript,
        engine: payload.engine ?? "deepgram",
        acceptedTileIds: snap.acceptedTileIds,
        orderedTileTexts: snap.orderedTileTexts,
        snapshotUtteranceKey: snap.snapshotUtteranceKey,
        commitmentLevel: "final",
        sessionTranscript: payload.sessionTranscript,
        retryTriggered: true,
        retryReason: payload.retryReason ?? null,
      });
    },
    endSession(payload = {}) {
      if (!active && endedRecording) return endedRecording;
      const sessionTranscript =
        payload.sessionTranscript ??
        events[events.length - 1]?.sessionTranscript ??
        "";
      const snap = snapshotFields(payload.snapshot);
      push({
        t: relativeT(),
        type: "session_end",
        acceptedTileIds:
          snap.acceptedTileIds.length > 0
            ? snap.acceptedTileIds
            : (events[events.length - 1]?.acceptedTileIds ?? []),
        orderedTileTexts:
          snap.orderedTileTexts.length > 0
            ? snap.orderedTileTexts
            : (events[events.length - 1]?.orderedTileTexts ?? []),
        snapshotUtteranceKey: snap.snapshotUtteranceKey,
        commitmentLevel: "none",
        sessionTranscript,
        note: payload.notes,
      });
      active = false;
      if (payload.notes) meta.notes = payload.notes;
      endedRecording = buildRecording(payload.userAbandoned === true);
      endedRecording.endedAt = new Date(nowMs()).toISOString();
      return endedRecording;
    },
    getRecording() {
      if (endedRecording) return endedRecording;
      return buildRecording(false);
    },
    isActive() {
      return active;
    },
  };
}
