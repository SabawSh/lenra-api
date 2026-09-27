"use client";

import { measureAudioBlob } from "@/helper/speech/audioBlobMetrics";
import { logUtteranceSnapshot } from "@/helper/speech/utteranceSnapshotDiagnostics";
import { useCallback, useRef } from "react";

/** Match Deepgram live slice cadence — low overhead, enough audio for retry. */
export const MEDIA_SLICE_MS = 200;

/** ~6s max per utterance (200ms slices). Retry only needs the latest phrase. */
export const MAX_UTTERANCE_CHUNKS = 30;

/** Upper bound on audio uploaded per Deepgram retry (~6s). */
export const MAX_UTTERANCE_AUDIO_MS = MEDIA_SLICE_MS * MAX_UTTERANCE_CHUNKS;

export type FinalizeUtteranceContext = {
  /** Web Speech final transcript for this utterance — diagnostic only. */
  transcript?: string;
};

export type UtteranceAudioSnapshot = {
  blob: Blob | null;
  snapshotNumber: number;
  transcript?: string;
  bytes: number;
  durationMs?: number;
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function assembleAudioBlob(chunks: readonly Blob[]): Blob | null {
  if (chunks.length === 0) return null;
  const mime = chunks[0]?.type || "audio/webm";
  return new Blob([...chunks], { type: mime });
}

/** WebM init segment lives in chunk 0 — keep it when trimming the rolling buffer. */
function trimChunksPreservingWebMHeader(chunks: Blob[]): Blob[] {
  if (chunks.length <= MAX_UTTERANCE_CHUNKS) return chunks;
  const header = chunks[0];
  const tail = chunks.slice(-(MAX_UTTERANCE_CHUNKS - 1));
  if (!header) return tail;
  if (tail[0] === header) return tail;
  return [header, ...tail];
}

function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

type ChunkSink = (chunk: Blob) => void;

/**
 * Stop MediaRecorder and wait until the final `dataavailable` flush completes.
 */
function stopMediaRecorderFlushed(
  recorder: MediaRecorder,
  onChunk: ChunkSink,
): Promise<void> {
  return new Promise((resolve) => {
    if (recorder.state === "inactive") {
      resolve();
      return;
    }

    let flushComplete = false;

    const onData = (event: BlobEvent) => {
      if (event.data.size > 0) {
        onChunk(event.data);
      }
      if (recorder.state === "inactive") {
        flushComplete = true;
        cleanup();
        resolve();
      }
    };

    const onStop = () => {
      if (flushComplete) return;
      queueMicrotask(() => {
        if (!flushComplete) {
          flushComplete = true;
          cleanup();
          resolve();
        }
      });
    };

    const cleanup = () => {
      recorder.removeEventListener("dataavailable", onData);
      recorder.removeEventListener("stop", onStop);
    };

    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", onStop, { once: true });

    try {
      recorder.stop();
    } catch {
      cleanup();
      resolve();
    }
  });
}

export type UseParallelAudioCaptureReturn = {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<Blob | null>;
  /**
   * Finalize the current utterance only; keeps the mic stream open for the next one.
   * Serialized — each Web Speech final gets its own snapshot (never shares a prior blob).
   */
  finalizeUtteranceBlob: (
    context?: FinalizeUtteranceContext,
  ) => Promise<UtteranceAudioSnapshot>;
  /** Resolves when all queued utterance finalizes have completed. */
  whenFinalizeIdle: () => Promise<void>;
};

/**
 * Buffers microphone audio in parallel with Web Speech for Deepgram retry.
 * Each Web Speech final finalizes one utterance blob — not the full mic session.
 */
export function useParallelAudioCapture(
  enabled: boolean,
): UseParallelAudioCaptureReturn {
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionBlobRef = useRef<Blob | null>(null);
  const mimeTypeRef = useRef<string | undefined>(undefined);
  const stopInFlightRef = useRef<Promise<Blob | null> | null>(null);
  const sessionActiveRef = useRef(false);
  const snapshotCounterRef = useRef(0);
  /** Serializes utterance finalizes so overlapping finals never share one blob. */
  const finalizeMutexRef = useRef<Promise<void>>(Promise.resolve());

  const whenFinalizeIdle = useCallback((): Promise<void> => {
    return finalizeMutexRef.current;
  }, []);

  const pushChunk = useCallback((chunk: Blob) => {
    chunksRef.current.push(chunk);
    chunksRef.current = trimChunksPreservingWebMHeader(chunksRef.current);
  }, []);

  const attachRecorder = useCallback(
    (stream: MediaStream) => {
      const recorder = mimeTypeRef.current
        ? new MediaRecorder(stream, {
            mimeType: mimeTypeRef.current,
            audioBitsPerSecond: 24_000,
          })
        : new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          pushChunk(event.data);
        }
      };

      recorder.start(MEDIA_SLICE_MS);
      recorderRef.current = recorder;
    },
    [pushChunk],
  );

  const restartUtteranceCapture = useCallback(() => {
    chunksRef.current = [];
    sessionBlobRef.current = null;

    const stream = streamRef.current;
    if (!sessionActiveRef.current || !stream || !stream.active) {
      recorderRef.current = null;
      return false;
    }

    attachRecorder(stream);
    return true;
  }, [attachRecorder]);

  const performUtteranceFinalize = useCallback(
    async (context?: FinalizeUtteranceContext): Promise<UtteranceAudioSnapshot> => {
      const snapshotNumber = ++snapshotCounterRef.current;
      const transcript = context?.transcript?.trim() || undefined;

      const recorder = recorderRef.current;
      let recorderRestarted = false;

      if (!recorder || recorder.state === "inactive") {
        const blob = assembleAudioBlob(chunksRef.current);
        recorderRestarted = restartUtteranceCapture();
        const metrics = await measureAudioBlob(blob);
        const snapshot: UtteranceAudioSnapshot = {
          blob,
          snapshotNumber,
          transcript,
          bytes: metrics.bytes,
          durationMs: metrics.durationMs,
        };
        logUtteranceSnapshot({
          snapshotNumber,
          transcript,
          bytes: metrics.bytes,
          durationMs: metrics.durationMs,
          recorderRestarted,
        });
        return snapshot;
      }

      recorder.ondataavailable = null;
      await stopMediaRecorderFlushed(recorder, pushChunk);

      const blob = assembleAudioBlob(chunksRef.current);
      recorderRef.current = null;
      recorderRestarted = restartUtteranceCapture();

      const metrics = await measureAudioBlob(blob);
      const snapshot: UtteranceAudioSnapshot = {
        blob,
        snapshotNumber,
        transcript,
        bytes: metrics.bytes,
        durationMs: metrics.durationMs,
      };
      logUtteranceSnapshot({
        snapshotNumber,
        transcript,
        bytes: metrics.bytes,
        durationMs: metrics.durationMs,
        recorderRestarted,
      });
      return snapshot;
    },
    [pushChunk, restartUtteranceCapture],
  );

  const finalizeUtteranceBlob = useCallback(
    async (context?: FinalizeUtteranceContext): Promise<UtteranceAudioSnapshot> => {
      const waitFor = finalizeMutexRef.current;
      let release!: () => void;
      const lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      finalizeMutexRef.current = lock;

      await waitFor;
      try {
        return await performUtteranceFinalize(context);
      } finally {
        release();
      }
    },
    [performUtteranceFinalize],
  );

  const startCapture = useCallback(async () => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    if (recorderRef.current?.state === "recording") return;

    chunksRef.current = [];
    sessionBlobRef.current = null;
    stopInFlightRef.current = null;
    snapshotCounterRef.current = 0;
    mimeTypeRef.current = pickRecorderMime();
    sessionActiveRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      attachRecorder(stream);
    } catch {
      sessionActiveRef.current = false;
      releaseStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
    }
  }, [attachRecorder, enabled]);

  const stopCapture = useCallback(async (): Promise<Blob | null> => {
    sessionActiveRef.current = false;
    if (sessionBlobRef.current) return sessionBlobRef.current;
    if (stopInFlightRef.current) return stopInFlightRef.current;

    const finalize = async (): Promise<Blob | null> => {
      await finalizeMutexRef.current;

      const recorder = recorderRef.current;
      if (!recorder) {
        const blob = assembleAudioBlob(chunksRef.current);
        sessionBlobRef.current = blob;
        return blob;
      }

      if (recorder.state === "inactive") {
        const blob = assembleAudioBlob(chunksRef.current);
        sessionBlobRef.current = blob;
        releaseStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        return blob;
      }

      recorder.ondataavailable = null;
      await stopMediaRecorderFlushed(recorder, pushChunk);

      const blob = assembleAudioBlob(chunksRef.current);
      sessionBlobRef.current = blob;
      releaseStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      return blob;
    };

    stopInFlightRef.current = finalize();
    try {
      return await stopInFlightRef.current;
    } finally {
      stopInFlightRef.current = null;
    }
  }, [pushChunk]);

  return {
    startCapture,
    stopCapture,
    finalizeUtteranceBlob,
    whenFinalizeIdle,
  };
}
