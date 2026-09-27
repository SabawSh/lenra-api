import { NextResponse } from "next/server";

import {
  executeContentImport,
  previewContentImport,
  type ContentImportMode,
} from "@/lib/content-import";
import type { ContentRefreshArtifactBundle } from "@/lib/content-refresh/types";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB per artifact
const FIELD_MAP = {
  clips: "clips",
  learningAnalysis: "learningAnalysis",
  translations: "translations",
  vocabularySenses: "vocabularySenses",
  vocabularyOccurrences: "vocabularyOccurrences",
  grammarOccurrences: "grammarOccurrences",
  grammarCatalog: "grammarCatalog",
} as const;

type ArtifactField = keyof typeof FIELD_MAP;

async function readJsonFile(
  file: File,
  label: string,
): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${label}: file too large (max 20MB)`);
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
}

async function parseMultipartArtifacts(
  form: FormData,
): Promise<{
  episodeId: string;
  mode: ContentImportMode;
  confirmReplace: boolean;
  artifacts: ContentRefreshArtifactBundle;
}> {
  const episodeId = String(form.get("episodeId") ?? "").trim();
  if (!episodeId) {
    throw new Error("episodeId is required");
  }

  const modeRaw = String(form.get("mode") ?? "insert").trim();
  const mode: ContentImportMode =
    modeRaw === "replace" ? "replace" : "insert";
  const confirmReplace =
    String(form.get("confirmReplace") ?? "").toLowerCase() === "true";

  const clipsFile = form.get("clips");
  if (!(clipsFile instanceof File) || clipsFile.size === 0) {
    throw new Error("clips.json is required");
  }

  const artifacts: ContentRefreshArtifactBundle = {
    clips: await readJsonFile(clipsFile, "clips.json"),
  };

  const optional: ArtifactField[] = [
    "learningAnalysis",
    "translations",
    "vocabularySenses",
    "vocabularyOccurrences",
    "grammarOccurrences",
    "grammarCatalog",
  ];

  for (const field of optional) {
    const value = form.get(field);
    if (value instanceof File && value.size > 0) {
      artifacts[field] = await readJsonFile(value, `${field}.json`);
    }
  }

  return { episodeId, mode, confirmReplace, artifacts };
}

/**
 * POST /api/admin/content-import
 * multipart: episodeId, mode, confirmReplace?, clips (+ optional artifact files)
 * query: ?dryRun=1 for preview only
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("preview") === "1";

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with artifact files" },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const parsed = await parseMultipartArtifacts(form);

    if (dryRun) {
      const result = await previewContentImport({
        episodeId: parsed.episodeId,
        artifacts: parsed.artifacts,
        mode: parsed.mode,
      });
      return NextResponse.json({ ok: true, stage: "preview", result });
    }

    const result = await executeContentImport({
      episodeId: parsed.episodeId,
      artifacts: parsed.artifacts,
      mode: parsed.mode,
      confirmReplace: parsed.confirmReplace,
    });

    // Parts UUIDs changed — bust lean curriculum caches so Learn does not 404
    // on stale part-order meta from the previous build.
    try {
      const { revalidateTag } = await import("next/cache");
      revalidateTag("videos", { expire: 0 });
      revalidateTag("episodes", { expire: 0 });
    } catch (error) {
      console.warn(
        "[content-import] cache revalidate skipped:",
        error instanceof Error ? error.message : error,
      );
    }

    return NextResponse.json({ ok: true, stage: "imported", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.includes("required") ||
      message.includes("invalid") ||
      message.includes("not present") ||
      message.includes("confirmReplace") ||
      message.includes("already has")
        ? 400
        : 500;
    return NextResponse.json(
      {
        ok: false,
        error: message,
        stage: dryRun ? "validation" : "import",
      },
      { status },
    );
  }
}
