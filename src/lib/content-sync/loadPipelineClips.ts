import { readFileSync } from "fs";
import type { PipelineClip, PipelineClipToken } from "./types";

export type PipelineClipsDocument = {
  version?: number;
  generatedAt?: string;
  source?: unknown;
  summary?: unknown;
  clips: PipelineClip[];
};

function asFiniteNumber(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`clips.json: invalid number for ${field}`);
  }
  return n;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLevel(value: unknown): "easy" | "medium" | "hard" {
  const raw = String(value ?? "easy").toLowerCase();
  if (raw === "medium" || raw === "hard" || raw === "easy") return raw;
  return "easy";
}

function parseTokens(raw: unknown): PipelineClipToken[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t != null && typeof t === "object") as PipelineClipToken[];
}

/**
 * Load and validate Content Pipeline `clips.json`.
 * Presentation order is the array index + 1 (artifact has no order field).
 */
export function loadPipelineClipsFromFile(path: string): PipelineClipsDocument {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsePipelineClipsDocument(raw);
}

export function parsePipelineClipsDocument(
  raw: unknown,
): PipelineClipsDocument {
  if (raw == null || typeof raw !== "object") {
    throw new Error("clips.json: expected top-level object");
  }
  const doc = raw as Record<string, unknown>;
  const list = doc.clips;
  if (!Array.isArray(list)) {
    throw new Error("clips.json: missing clips[] array");
  }

  const clips: PipelineClip[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item == null || typeof item !== "object") {
      throw new Error(`clips.json: clip[${i}] is not an object`);
    }
    const c = item as Record<string, unknown>;
    const canonicalKey = String(c.canonicalKey ?? "").trim();
    if (!canonicalKey) {
      throw new Error(`clips.json: clip[${i}] missing canonicalKey`);
    }
    const text = String(c.text ?? "");
    if (!text.trim()) {
      throw new Error(`clips.json: clip[${i}] missing text`);
    }
    const metrics =
      c.metrics != null && typeof c.metrics === "object"
        ? (c.metrics as PipelineClip["metrics"])
        : null;
    const hls =
      c.hls != null && typeof c.hls === "object"
        ? (c.hls as PipelineClip["hls"])
        : null;

    clips.push({
      pipelineId: String(c.id ?? `pipeline-${i + 1}`),
      order: i + 1,
      canonicalKey,
      text,
      startMs: asFiniteNumber(c.startMs, `clips[${i}].startMs`),
      endMs: asFiniteNumber(c.endMs, `clips[${i}].endMs`),
      durationMs: asFiniteNumber(c.durationMs, `clips[${i}].durationMs`),
      speechStartMs: asOptionalNumber(c.speechStartMs),
      speechEndMs: asOptionalNumber(c.speechEndMs),
      speechDurationMs: asOptionalNumber(c.speechDurationMs),
      level: parseLevel(c.level),
      difficultyScore: asOptionalNumber(c.difficultyScore),
      tokens: parseTokens(c.tokens),
      metrics,
      sourceCues: Array.isArray(c.sourceCues)
        ? (c.sourceCues as string[])
        : null,
      sourceCueIndexes: Array.isArray(c.sourceCueIndexes)
        ? (c.sourceCueIndexes as number[])
        : null,
      hls,
      encodeStartMs: asOptionalNumber(c.encodeStartMs),
      encodeEndMs: asOptionalNumber(c.encodeEndMs),
    });
  }

  return {
    version: typeof doc.version === "number" ? doc.version : undefined,
    generatedAt:
      typeof doc.generatedAt === "string" ? doc.generatedAt : undefined,
    source: doc.source,
    summary: doc.summary,
    clips,
  };
}
