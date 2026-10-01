/**
 * Speech chain inspector store — observe-only correlated STT events.
 * Powers console `[speech-chain]` logs and the Speech Chain Inspector UI.
 *
 * Does not change matching, placement, normalize, or replay execution.
 */
import { resolveVoiceMatchingConfig } from "@/helper/voiceMatching/voiceMatchingConfig";

export type SpeechChainTraceStage =
  | "session_start"
  | "chrome_raw"
  | "merged_hypothesis"
  | "session_gate_kept"
  | "session_gate_dropped"
  | "app_gate_dropped"
  | "pipeline_stages"
  | "recorder_saved"
  | "recorder_skipped_inactive"
  | "export_written";

export type SpeechChainBrowserResult = {
  resultIndex: number;
  isFinal: boolean;
  confidence?: number;
  alternatives: string[];
};

export type SpeechChainMatcherReject = {
  tileId: string;
  text: string;
  reason: string;
  /** Present only when captured; RejectedTile currently omits scores. */
  similarity?: number | null;
  threshold?: number | null;
  spoken?: string | null;
};

export type SpeechChainRecorderStatus =
  | { status: "pending" }
  | { status: "recorded"; eventIndex: number; type: string; t: number }
  | { status: "dropped"; reason: string };

export type SpeechChainInspectorEvent = {
  id: string;
  seq: number;
  /** ms since session_start / first event in buffer */
  t: number;
  wallMs: number;
  iso: string;
  /** Best-effort label for the timeline row */
  eventType:
    | "hypothesis"
    | "transcript"
    | "mic_release"
    | "retry_transcript"
    | "unknown";
  label: string;

  browser: {
    results: SpeechChainBrowserResult[];
  };
  merge: {
    mergedHypothesis: string;
    finalsOnly?: string;
    lastFinal?: boolean;
  };
  normalize: {
    raw: string;
    normalized: string;
  };
  rewrite: {
    rewritten: string;
  };
  matcher: {
    input: string;
    accepted: Array<{ id: string; text: string; acceptReason?: string }>;
    rejected: SpeechChainMatcherReject[];
    phraseSimilarityThreshold?: number;
    phraseKnowledgeThreshold?: number;
  };
  placement: {
    orderedTileTexts: string[];
    acceptedTileIds: string[];
    stickyPlacedIds: string[];
    commitmentLevel?: string;
    sessionTranscript?: string;
  };
  recorder: SpeechChainRecorderStatus;
  exportStatus: {
    exported: boolean;
    exportEventIndex?: number;
  };
  gates: {
    session?: "kept" | "dropped";
    sessionDropReason?: string;
    app?: "kept" | "dropped";
    appDropReason?: string;
  };
  /** Full JSON-serializable snapshot for Copy */
  rawDetail: Record<string, unknown>;
};

export type SpeechChainTraceEntry = {
  seq: number;
  wallMs: number;
  iso: string;
  stage: SpeechChainTraceStage;
  eventId?: string;
  detail: Record<string, unknown>;
};

type Listener = () => void;

const MAX_EVENTS = 500;
const MAX_ENTRIES = 2000;

let seq = 0;
let sessionOriginWallMs: number | null = null;
let activeEventId: string | null = null;
const events = new Map<string, SpeechChainInspectorEvent>();
const eventOrder: string[] = [];
const entries: SpeechChainTraceEntry[] = [];
const listeners = new Set<Listener>();

/** Last exported replay event transcripts (for export ✓ / diff). */
let lastExportSnapshot: Array<{
  exportEventIndex: number;
  t: number;
  type: string;
  transcript: string;
}> = [];

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function subscribeSpeechChainInspector(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Speech chain inspector / replay dev tools removed — trace collection off. */
export function speechChainTraceEnabled(): boolean {
  return false;
}

function relativeT(wallMs: number): number {
  if (sessionOriginWallMs == null) sessionOriginWallMs = wallMs;
  return Math.max(0, Math.round(wallMs - sessionOriginWallMs));
}

function emptyEvent(id: string, wallMs: number): SpeechChainInspectorEvent {
  return {
    id,
    seq: ++seq,
    t: relativeT(wallMs),
    wallMs,
    iso: new Date().toISOString(),
    eventType: "unknown",
    label: "",
    browser: { results: [] },
    merge: { mergedHypothesis: "" },
    normalize: { raw: "", normalized: "" },
    rewrite: { rewritten: "" },
    matcher: {
      input: "",
      accepted: [],
      rejected: [],
      phraseSimilarityThreshold:
        resolveVoiceMatchingConfig().phraseSimilarityThreshold,
      phraseKnowledgeThreshold:
        resolveVoiceMatchingConfig().phraseKnowledgeThreshold,
    },
    placement: {
      orderedTileTexts: [],
      acceptedTileIds: [],
      stickyPlacedIds: [],
    },
    recorder: { status: "pending" },
    exportStatus: { exported: false },
    gates: {},
    rawDetail: {},
  };
}

function touchLabel(event: SpeechChainInspectorEvent): void {
  const text =
    event.merge.mergedHypothesis ||
    event.normalize.raw ||
    event.browser.results[0]?.alternatives[0] ||
    "";
  event.label = text;
  if (event.eventType === "unknown") {
    if (event.merge.lastFinal) event.eventType = "hypothesis";
    else if (event.merge.mergedHypothesis) event.eventType = "hypothesis";
  }
}

function getOrCreate(id: string, wallMs: number): SpeechChainInspectorEvent {
  let event = events.get(id);
  if (!event) {
    event = emptyEvent(id, wallMs);
    events.set(id, event);
    eventOrder.push(id);
    while (eventOrder.length > MAX_EVENTS) {
      const drop = eventOrder.shift();
      if (drop) events.delete(drop);
    }
  }
  return event;
}

export function clearSpeechChainTrace(): void {
  entries.length = 0;
  events.clear();
  eventOrder.length = 0;
  seq = 0;
  sessionOriginWallMs = null;
  activeEventId = null;
  lastExportSnapshot = [];
  notify();
}

export function getSpeechChainTrace(): readonly SpeechChainTraceEntry[] {
  return entries;
}

export function getSpeechChainInspectorEvents(): SpeechChainInspectorEvent[] {
  return eventOrder
    .map((id) => events.get(id))
    .filter((e): e is SpeechChainInspectorEvent => !!e);
}

export function getActiveSpeechChainEventId(): string | null {
  return activeEventId;
}

export function beginSpeechChainEvent(kind?: string): string {
  const wallMs =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const id = `e${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  activeEventId = id;
  const event = getOrCreate(id, wallMs);
  if (kind === "transcript") event.eventType = "transcript";
  if (kind === "hypothesis") event.eventType = "hypothesis";
  if (kind === "mic_release") event.eventType = "mic_release";
  notify();
  return id;
}

export function endSpeechChainEvent(): void {
  activeEventId = null;
}

/** Run observe-only work while temporarily binding the active chain event. */
export function withSpeechChainEventId<T>(
  eventId: string | null | undefined,
  fn: () => T,
): T {
  if (!eventId) return fn();
  const prev = activeEventId;
  activeEventId = eventId;
  try {
    return fn();
  } finally {
    activeEventId = prev;
  }
}

export function patchSpeechChainEvent(
  eventId: string | null | undefined,
  patch: (event: SpeechChainInspectorEvent) => void,
): void {
  if (!speechChainTraceEnabled()) return;
  const id = eventId ?? activeEventId;
  if (!id) return;
  const wallMs =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const event = getOrCreate(id, wallMs);
  patch(event);
  touchLabel(event);
  event.rawDetail = {
    id: event.id,
    t: event.t,
    eventType: event.eventType,
    label: event.label,
    browser: event.browser,
    merge: event.merge,
    normalize: event.normalize,
    rewrite: event.rewrite,
    matcher: event.matcher,
    placement: event.placement,
    recorder: event.recorder,
    exportStatus: event.exportStatus,
    gates: event.gates,
  };
  notify();
}

export function pushSpeechChainTrace(
  stage: SpeechChainTraceStage,
  detail: Record<string, unknown>,
  consoleLines?: string[],
  eventId?: string | null,
): SpeechChainTraceEntry | null {
  if (!speechChainTraceEnabled()) return null;
  const wallMs =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const resolvedId = eventId ?? activeEventId ?? undefined;
  const entry: SpeechChainTraceEntry = {
    seq: ++seq,
    wallMs,
    iso: new Date().toISOString(),
    stage,
    eventId: resolvedId,
    detail,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  void consoleLines;

  if (resolvedId) {
    applyStageToEvent(resolvedId, stage, detail, wallMs);
  }
  return entry;
}

function applyStageToEvent(
  eventId: string,
  stage: SpeechChainTraceStage,
  detail: Record<string, unknown>,
  wallMs: number,
): void {
  patchSpeechChainEvent(eventId, (event) => {
    event.wallMs = wallMs;
    switch (stage) {
      case "chrome_raw": {
        const alternatives = Array.isArray(detail.alternatives)
          ? (detail.alternatives as string[])
          : [];
        event.browser.results.push({
          resultIndex: Number(detail.resultIndex ?? 0),
          isFinal: detail.isFinal === true,
          confidence:
            typeof detail.confidence === "number"
              ? detail.confidence
              : undefined,
          alternatives,
        });
        break;
      }
      case "merged_hypothesis": {
        event.merge = {
          mergedHypothesis: String(detail.mergedHypothesis ?? ""),
          finalsOnly:
            typeof detail.finalsOnly === "string"
              ? detail.finalsOnly
              : undefined,
          lastFinal:
            typeof detail.lastFinal === "boolean"
              ? detail.lastFinal
              : undefined,
        };
        event.eventType = "hypothesis";
        break;
      }
      case "session_gate_kept": {
        event.gates.session = "kept";
        if (detail.kind === "transcript") event.eventType = "transcript";
        if (typeof detail.text === "string" && !event.merge.mergedHypothesis) {
          event.merge.mergedHypothesis = detail.text;
        }
        break;
      }
      case "session_gate_dropped": {
        event.gates.session = "dropped";
        event.gates.sessionDropReason = String(
          detail.reason ?? "listeningEnabled=false",
        );
        event.recorder = {
          status: "dropped",
          reason: String(detail.reason ?? "listeningEnabled=false"),
        };
        if (typeof detail.text === "string") {
          event.merge.mergedHypothesis = detail.text;
          event.normalize.raw = detail.text;
        }
        if (detail.kind === "transcript") event.eventType = "transcript";
        break;
      }
      case "app_gate_dropped": {
        event.gates.app = "dropped";
        event.gates.appDropReason = String(
          detail.reason ?? "orderStatus=correct",
        );
        event.recorder = {
          status: "dropped",
          reason: String(detail.reason ?? "orderStatus=correct"),
        };
        if (typeof detail.text === "string") {
          event.normalize.raw = detail.text;
        }
        break;
      }
      case "pipeline_stages": {
        if (typeof detail.raw === "string") event.normalize.raw = detail.raw;
        if (typeof detail.normalized === "string") {
          event.normalize.normalized = detail.normalized;
        }
        if (typeof detail.rewritten === "string") {
          event.rewrite.rewritten = detail.rewritten;
        }
        if (typeof detail.matcherInput === "string") {
          event.matcher.input = detail.matcherInput;
        }
        if (Array.isArray(detail.accepted)) {
          event.matcher.accepted = detail.accepted as SpeechChainInspectorEvent["matcher"]["accepted"];
        }
        if (Array.isArray(detail.rejected)) {
          event.matcher.rejected = detail.rejected as SpeechChainMatcherReject[];
        }
        if (Array.isArray(detail.orderedTileTexts)) {
          event.placement.orderedTileTexts = detail.orderedTileTexts as string[];
        }
        if (Array.isArray(detail.acceptedTileIds)) {
          event.placement.acceptedTileIds = detail.acceptedTileIds as string[];
        }
        if (Array.isArray(detail.stickyPlacedIds)) {
          event.placement.stickyPlacedIds = detail.stickyPlacedIds as string[];
        }
        if (typeof detail.commitmentLevel === "string") {
          event.placement.commitmentLevel = detail.commitmentLevel;
        }
        if (typeof detail.sessionTranscript === "string") {
          event.placement.sessionTranscript = detail.sessionTranscript;
        }
        if (detail.kind === "transcript") event.eventType = "transcript";
        if (detail.kind === "hypothesis") event.eventType = "hypothesis";
        event.gates.app = event.gates.app ?? "kept";
        break;
      }
      case "recorder_saved": {
        event.recorder = {
          status: "recorded",
          eventIndex: Number(detail.eventIndex ?? 0),
          type: String(detail.type ?? "hypothesis"),
          t: Number(detail.t ?? event.t),
        };
        if (typeof detail.raw === "string") event.normalize.raw = detail.raw;
        if (typeof detail.normalized === "string") {
          event.normalize.normalized = detail.normalized;
        }
        break;
      }
      case "recorder_skipped_inactive": {
        event.recorder = {
          status: "dropped",
          reason: String(detail.reason ?? "inactive recorder"),
        };
        break;
      }
      default:
        break;
    }
  });
}

export function markSpeechChainExport(
  exportedEvents: Array<{
    exportEventIndex: number;
    t: number;
    type: string;
    transcript: string;
  }>,
): void {
  lastExportSnapshot = exportedEvents;
  const used = new Set<number>();
  for (const id of eventOrder) {
    const event = events.get(id);
    if (!event) continue;
    event.exportStatus = { exported: false };
    if (event.recorder.status !== "recorded") continue;
    const raw = event.normalize.raw || event.merge.mergedHypothesis;
    const match = exportedEvents.find(
      (row, index) =>
        !used.has(index) &&
        row.transcript === raw &&
        (row.type === event.eventType ||
          (row.type === "hypothesis" && event.eventType === "hypothesis") ||
          (row.type === "transcript" && event.eventType === "transcript")),
    );
    if (match) {
      used.add(match.exportEventIndex);
      event.exportStatus = {
        exported: true,
        exportEventIndex: match.exportEventIndex,
      };
    }
  }
  notify();
}

export function getLastSpeechChainExportSnapshot() {
  return lastExportSnapshot;
}

export function findSpeechChainTraceMentions(
  needle: string,
): SpeechChainTraceEntry[] {
  const lower = needle.toLowerCase();
  return entries.filter((entry) =>
    JSON.stringify(entry).toLowerCase().includes(lower),
  );
}

export function findSpeechChainInspectorEvents(
  needle: string,
): SpeechChainInspectorEvent[] {
  const lower = needle.trim().toLowerCase();
  if (!lower) return getSpeechChainInspectorEvents();
  return getSpeechChainInspectorEvents().filter((event) =>
    JSON.stringify(event.rawDetail).toLowerCase().includes(lower),
  );
}

export type LenraSpeechChainTraceWindowApi = {
  dump: () => SpeechChainTraceEntry[];
  events: () => SpeechChainInspectorEvent[];
  clear: () => void;
  find: (needle: string) => SpeechChainTraceEntry[];
  findEvents: (needle: string) => SpeechChainInspectorEvent[];
  enabled: () => boolean;
};

export function installSpeechChainTraceWindowApi(): void {
  if (typeof window === "undefined") return;
  const api: LenraSpeechChainTraceWindowApi = {
    dump: () => [...entries],
    events: () => getSpeechChainInspectorEvents(),
    clear: () => {
      clearSpeechChainTrace();
    },
    find: (needle) => findSpeechChainTraceMentions(needle),
    findEvents: (needle) => findSpeechChainInspectorEvents(needle),
    enabled: () => speechChainTraceEnabled(),
  };
  (
    window as unknown as {
      __lenraSpeechChainTrace?: LenraSpeechChainTraceWindowApi;
    }
  ).__lenraSpeechChainTrace = api;
}
