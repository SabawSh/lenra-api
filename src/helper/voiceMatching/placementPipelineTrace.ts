/**
 * Debug-gated placement pipeline tracer.
 *
 * Enable with VOICE_MATCH_DEBUG=1 or NEXT_PUBLIC_STT_FALLBACK_DEBUG=1.
 * Logs INPUT / OUTPUT / ms and absolute t= offsets from the first mark in a
 * transcript snapshot so latency bottlenecks are measurable end-to-end.
 */

import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";

export type PipelineTraceSession = {
  /** Wall-clock origin for this transcript snapshot (performance.now()). */
  readonly originMs: number;
  readonly transcriptLabel: string;
};

/** Browser / Node clock — avoids shadowing by props named `performance`. */
export function pipelineNowMs(): number {
  return globalThis.performance.now();
}

function traceEnabled(): boolean {
  return (
    process.env.VOICE_MATCH_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_STT_FALLBACK_DEBUG === "1" ||
    resolveSttFallbackConfig().debug
  );
}

export function beginPipelineTrace(
  transcriptLabel: string,
): PipelineTraceSession | null {
  if (!traceEnabled()) return null;
  const originMs = pipelineNowMs();
  return { originMs, transcriptLabel };
}

export function logPipelineStage(
  session: PipelineTraceSession | null,
  _stage: string,
  _input: unknown,
  _output: unknown,
  _startedAtMs: number,
): void {
  void session;
}

/**
 * Structured reject log — exact candidate, reason, function, and condition.
 */
export function logCandidateRejection(_input: {
  candidate: string;
  tileId?: string;
  reason: string;
  functionName: string;
  condition: string;
  window?: { start: number; end: number; tokens: readonly string[] };
  consumedSpans?: readonly { start: number; end: number }[];
  session?: PipelineTraceSession | null;
}): void {
  if (!traceEnabled()) return;
}
