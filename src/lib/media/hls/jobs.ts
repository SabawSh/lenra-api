import fs from "node:fs";
import path from "node:path";

import { transcodeToHls } from "@/lib/media/ffmpeg/hls";
import {
  hlsOutputRoot,
  isHlsPackageReady,
  resolveHlsPublicUrl,
  sanitizeVideoId,
} from "@/lib/media/hls/paths";
import type { HlsJobRecord, HlsJobStatus } from "@/lib/media/hls/types";

const JOBS_DIR_NAME = ".jobs";

function jobsDir(): string {
  return path.join(hlsOutputRoot(), JOBS_DIR_NAME);
}

function jobFilePath(videoId: string): string {
  const safe = sanitizeVideoId(videoId);
  if (!safe) {
    throw new Error(`Invalid videoId: ${videoId}`);
  }
  return path.join(jobsDir(), `${safe}.json`);
}

function writeJob(record: HlsJobRecord): void {
  fs.mkdirSync(jobsDir(), { recursive: true });
  fs.writeFileSync(jobFilePath(record.videoId), JSON.stringify(record, null, 2));
}

export function readHlsJob(videoId: string): HlsJobRecord | null {
  const safe = sanitizeVideoId(videoId);
  if (!safe) return null;

  const filePath = path.join(jobsDir(), `${safe}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as HlsJobRecord;
  } catch {
    return null;
  }
}

export function createProcessingJob(
  videoId: string,
  sourcePath: string,
  segmentSeconds: number,
): HlsJobRecord {
  const now = new Date().toISOString();
  const record: HlsJobRecord = {
    videoId,
    status: "processing",
    sourcePath,
    startedAt: now,
    updatedAt: now,
    segmentSeconds,
  };
  writeJob(record);
  return record;
}

function updateJob(
  videoId: string,
  patch: Partial<HlsJobRecord> & { status: HlsJobStatus },
): HlsJobRecord {
  const existing = readHlsJob(videoId);
  const now = new Date().toISOString();
  const record: HlsJobRecord = {
    videoId,
    status: patch.status,
    sourcePath: existing?.sourcePath ?? patch.sourcePath ?? "",
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    segmentSeconds: existing?.segmentSeconds ?? patch.segmentSeconds ?? 3,
    ...existing,
    ...patch,
    updatedAt: now,
  };
  writeJob(record);
  return record;
}

const inFlight = new Set<string>();

/**
 * Starts transcoding without blocking the HTTP response.
 * Safe to call multiple times — only one in-process encode per `videoId`.
 */
export function scheduleHlsTranscode(params: {
  videoId: string;
  sourcePath: string;
  segmentSeconds?: number;
}): void {
  const safe = sanitizeVideoId(params.videoId);
  if (!safe || inFlight.has(safe)) {
    return;
  }

  inFlight.add(safe);
  createProcessingJob(safe, params.sourcePath, params.segmentSeconds ?? 3);

  void (async () => {
    try {
      await transcodeToHls({
        videoId: safe,
        sourcePath: params.sourcePath,
        segmentSeconds: params.segmentSeconds,
        onProgress: (message) => {
        },
      });

      updateJob(safe, {
        status: "done",
        finishedAt: new Date().toISOString(),
        hlsUrl: resolveHlsPublicUrl(safe, "master.m3u8"),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "HLS transcode failed";
      console.error(`[hls:${safe}]`, error);
      updateJob(safe, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
      });
    } finally {
      inFlight.delete(safe);
    }
  })();
}

export function resolveHlsJobStatus(videoId: string): {
  status: HlsJobStatus | "idle";
  hlsUrl: string;
  job: HlsJobRecord | null;
} {
  const safe = sanitizeVideoId(videoId);
  if (!safe) {
    return { status: "idle", hlsUrl: "", job: null };
  }

  const hlsUrl = resolveHlsPublicUrl(safe, "master.m3u8");

  if (isHlsPackageReady(safe)) {
    return { status: "done", hlsUrl, job: readHlsJob(safe) };
  }

  const job = readHlsJob(safe);
  if (job?.status === "processing") {
    return { status: "processing", hlsUrl, job };
  }
  if (job?.status === "failed") {
    return { status: "failed", hlsUrl, job };
  }

  return { status: "idle", hlsUrl, job };
}
