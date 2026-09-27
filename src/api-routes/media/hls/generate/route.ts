import { NextResponse } from "next/server";

import { DEFAULT_HLS_SEGMENT_SECONDS } from "@/lib/media/ffmpeg/hls";
import { getPlaybackManifest } from "@/lib/media/hls/getPlaybackManifest";
import {
  readHlsJob,
  resolveHlsJobStatus,
  scheduleHlsTranscode,
} from "@/lib/media/hls/jobs";
import {
  resolveHlsPublicUrl,
  resolveSourcePath,
  sanitizeVideoId,
} from "@/lib/media/hls/paths";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";

/** Long-running FFmpeg — use a persistent Node host (not short serverless timeouts). */
export const maxDuration = 300;

type GenerateBody = {
  videoId?: string;
  sourcePath?: string;
  segmentSeconds?: number;
};

function parseSegmentSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(4, Math.max(2, Math.round(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) {
      return Math.min(4, Math.max(2, n));
    }
  }
  return undefined;
}

/**
 * POST /api/media/hls/generate
 *
 * Starts (or resumes) HLS packaging for a full source video. Output:
 * `public/media/hls/{videoId}/master.m3u8` (+ 360p/720p renditions).
 *
 * Subtitle alignment: encode is full-source from t=0 — use clean-clips `startMs`÷1000
 * as `video.currentTime` in hls.js (see `subtitleMsToPlaybackSeconds`).
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  const sourcePath =
    typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";

  if (!videoId || !sourcePath) {
    return NextResponse.json(
      { error: "videoId and sourcePath are required" },
      { status: 400 },
    );
  }

  const safeId = sanitizeVideoId(videoId);
  if (!safeId) {
    return NextResponse.json(
      { error: "videoId must be alphanumeric (max 128 chars)" },
      { status: 400 },
    );
  }

  try {
    resolveSourcePath(sourcePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid sourcePath";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const segmentSeconds =
    parseSegmentSeconds(body.segmentSeconds) ?? DEFAULT_HLS_SEGMENT_SECONDS;
  const hlsUrl = resolveHlsPublicUrl(safeId, "master.m3u8");

  const existing = resolveHlsJobStatus(safeId);
  if (existing.status === "done") {
    const manifest = getPlaybackManifest(safeId);
    return NextResponse.json({
      status: "done" as const,
      hlsUrl,
      videoId: safeId,
      manifest,
      job: readHlsJob(safeId),
    });
  }

  if (existing.status === "processing") {
    return NextResponse.json({
      status: "processing" as const,
      hlsUrl,
      videoId: safeId,
      job: existing.job,
    });
  }

  scheduleHlsTranscode({
    videoId: safeId,
    sourcePath,
    segmentSeconds,
  });

  return NextResponse.json(
    {
      status: "processing" as const,
      hlsUrl,
      videoId: safeId,
      segmentSeconds,
      output: {
        localRoot: `public/media/hls/${safeId}`,
        cdnKeyPrefix: `hls/${safeId}/`,
      },
    },
    { status: 202 },
  );
}

/**
 * GET /api/media/hls/generate?videoId=…
 *
 * Poll job status / playback manifest without starting a new encode.
 */
export async function GET(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const videoId = new URL(req.url).searchParams.get("videoId")?.trim() ?? "";
  const safeId = sanitizeVideoId(videoId);

  if (!safeId) {
    return NextResponse.json(
      { error: "videoId query parameter is required" },
      { status: 400 },
    );
  }

  const { status, hlsUrl, job } = resolveHlsJobStatus(safeId);
  const manifest = status === "done" ? getPlaybackManifest(safeId) : null;

  return NextResponse.json({
    status,
    hlsUrl,
    videoId: safeId,
    manifest,
    job,
  });
}
