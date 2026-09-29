import { NextResponse } from "next/server";

import {
  ContentImportRunTimer,
  logContentImport,
  mysqlErrorMeta,
} from "@/lib/admin/contentImportDebug";
import {
  executeContentImport,
  previewContentImport,
  type ContentImportMode,
} from "@/lib/content-import";
import type { ContentRefreshArtifactBundle } from "@/lib/content-refresh/types";

export const CONTENT_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const CONTENT_IMPORT_MAX_TOTAL_BYTES = 140 * 1024 * 1024;

const OPTIONAL_ARTIFACT_FIELDS = [
  "learningAnalysis",
  "translations",
  "vocabularySenses",
  "vocabularyOccurrences",
  "grammarOccurrences",
  "grammarCatalog",
] as const;

type OptionalArtifactField = (typeof OPTIONAL_ARTIFACT_FIELDS)[number];

export type ContentImportParsedRequest = {
  episodeId: string;
  mode: ContentImportMode;
  confirmReplace: boolean;
  artifacts: ContentRefreshArtifactBundle;
  bytesByField: Record<string, number>;
};

export type ContentImportJsonBody = {
  episodeId?: unknown;
  mode?: unknown;
  confirmReplace?: unknown;
  artifacts?: unknown;
};

function parseMode(raw: unknown): ContentImportMode {
  const modeRaw = String(raw ?? "insert").trim();
  return modeRaw === "replace" ? "replace" : "insert";
}

function parseConfirmReplace(raw: unknown): boolean {
  if (raw === true) return true;
  return String(raw ?? "").toLowerCase() === "true";
}

export function buildArtifactBundle(
  clips: unknown,
  optional: Partial<Record<OptionalArtifactField, unknown>>,
): ContentRefreshArtifactBundle {
  const artifacts: ContentRefreshArtifactBundle = { clips };
  for (const field of OPTIONAL_ARTIFACT_FIELDS) {
    const value = optional[field];
    if (value !== undefined && value !== null) {
      artifacts[field] = value;
    }
  }
  return artifacts;
}

function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

export function parseJsonContentImportBody(body: unknown): ContentImportParsedRequest {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected JSON object body");
  }
  const doc = body as ContentImportJsonBody;

  const episodeId = String(doc.episodeId ?? "").trim();
  if (!episodeId) {
    throw new Error("episodeId is required");
  }

  const mode = parseMode(doc.mode);
  const confirmReplace = parseConfirmReplace(doc.confirmReplace);

  if (doc.artifacts == null || typeof doc.artifacts !== "object" || Array.isArray(doc.artifacts)) {
    throw new Error("artifacts object is required");
  }

  const artifactsRaw = doc.artifacts as Record<string, unknown>;
  if (artifactsRaw.clips == null) {
    throw new Error("clips.json is required");
  }

  const optional: Partial<Record<OptionalArtifactField, unknown>> = {};
  let totalBytes = estimateJsonBytes(artifactsRaw.clips);
  const bytesByField: Record<string, number> = {
    clips: totalBytes,
  };

  for (const field of OPTIONAL_ARTIFACT_FIELDS) {
    const value = artifactsRaw[field];
    if (value === undefined || value === null) continue;
    const size = estimateJsonBytes(value);
    totalBytes += size;
    bytesByField[field] = size;
    if (totalBytes > CONTENT_IMPORT_MAX_TOTAL_BYTES) {
      throw new Error(
        `Total upload too large (max ${Math.floor(CONTENT_IMPORT_MAX_TOTAL_BYTES / (1024 * 1024))}MB combined, got ${Math.ceil(totalBytes / (1024 * 1024))}MB)`,
      );
    }
    optional[field] = value;
  }

  for (const [field, size] of Object.entries(bytesByField)) {
    if (size > CONTENT_IMPORT_MAX_FILE_BYTES) {
      throw new Error(`${field}.json: file too large (max 20MB)`);
    }
  }

  return {
    episodeId,
    mode,
    confirmReplace,
    artifacts: buildArtifactBundle(artifactsRaw.clips, optional),
    bytesByField,
  };
}

async function readJsonFile(file: File, label: string): Promise<unknown> {
  if (file.size > CONTENT_IMPORT_MAX_FILE_BYTES) {
    throw new Error(`${label}: file too large (max 20MB)`);
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
}

export async function parseMultipartContentImport(
  form: FormData,
): Promise<ContentImportParsedRequest> {
  const episodeId = String(form.get("episodeId") ?? "").trim();
  if (!episodeId) {
    throw new Error("episodeId is required");
  }

  const mode = parseMode(form.get("mode"));
  const confirmReplace = parseConfirmReplace(form.get("confirmReplace"));

  const clipsFile = form.get("clips");
  if (!(clipsFile instanceof File) || clipsFile.size === 0) {
    throw new Error("clips.json is required");
  }

  let totalBytes = clipsFile.size;
  const bytesByField: Record<string, number> = { clips: clipsFile.size };

  const clips = await readJsonFile(clipsFile, "clips.json");
  const optional: Partial<Record<OptionalArtifactField, unknown>> = {};

  for (const field of OPTIONAL_ARTIFACT_FIELDS) {
    const value = form.get(field);
    if (value instanceof File && value.size > 0) {
      totalBytes += value.size;
      bytesByField[field] = value.size;
      if (totalBytes > CONTENT_IMPORT_MAX_TOTAL_BYTES) {
        throw new Error(
          `Total upload too large (max ${Math.floor(CONTENT_IMPORT_MAX_TOTAL_BYTES / (1024 * 1024))}MB combined, got ${Math.ceil(totalBytes / (1024 * 1024))}MB)`,
        );
      }
      optional[field] = await readJsonFile(value, `${field}.json`);
    }
  }

  return {
    episodeId,
    mode,
    confirmReplace,
    artifacts: buildArtifactBundle(clips, optional),
    bytesByField,
  };
}

export function mapContentImportErrorStatus(
  message: string,
  meta: ReturnType<typeof mysqlErrorMeta>,
): number {
  const dupEntry =
    meta.code === "ER_DUP_ENTRY" || message.includes("Duplicate entry");

  return message.includes("too large") || message.includes("Total upload")
    ? 413
    : dupEntry
      ? 409
      : message.includes("required") ||
          message.includes("invalid") ||
          message.includes("expected") ||
          message.includes("missing") ||
          message.includes("not present") ||
          message.includes("confirmReplace") ||
          message.includes("already has") ||
          message.includes("Use replace mode") ||
          message.includes("Refusing Apply") ||
          message.includes(".json") ||
          message.includes("Expected JSON")
        ? 400
        : 500;
}

export function contentImportErrorResponse(
  error: unknown,
  dryRun: boolean,
  contentLength: string | null,
  logScope: "import" | "json",
): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const meta = mysqlErrorMeta(error);
  logContentImport(logScope, "failed", {
    dryRun,
    message,
    contentLength,
    ...meta,
  });

  const status = mapContentImportErrorStatus(message, meta);

  return NextResponse.json(
    {
      ok: false,
      error: message,
      stage: dryRun ? "validation" : "import",
      mysqlCode: meta.code,
      detail: meta.sqlMessage,
    },
    { status },
  );
}

export type RunContentImportOptions = {
  dryRun: boolean;
  logScope: "import" | "json";
  contentLength: string | null;
  parsed: ContentImportParsedRequest;
  requestTimer: ContentImportRunTimer;
};

export async function runContentImportFromParsed(
  options: RunContentImportOptions,
): Promise<NextResponse> {
  const { dryRun, logScope, contentLength, parsed, requestTimer } = options;

  logContentImport(logScope, "artifacts received", {
    episodeId: parsed.episodeId,
    mode: parsed.mode,
    dryRun,
    bytesByField: parsed.bytesByField,
  });

  if (dryRun) {
    const result = await previewContentImport({
      episodeId: parsed.episodeId,
      artifacts: parsed.artifacts,
      mode: parsed.mode,
    });
    requestTimer.phase("preview-complete");
    return NextResponse.json({ ok: true, stage: "preview", result });
  }

  const result = await executeContentImport({
    episodeId: parsed.episodeId,
    artifacts: parsed.artifacts,
    mode: parsed.mode,
    confirmReplace: parsed.confirmReplace,
  });

  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("videos", { expire: 0 });
    revalidateTag("episodes", { expire: 0 });
  } catch (error) {
    logContentImport(logScope, "cache revalidate skipped", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  requestTimer.phase("import-complete");
  return NextResponse.json({ ok: true, stage: "imported", result });
}

export function isContentImportDryRun(url: URL): boolean {
  return (
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("preview") === "1"
  );
}
