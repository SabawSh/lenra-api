import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { probeVideo } from "@/lib/media/ffmpeg/probe";
import {
  hlsMasterPlaylistPath,
  hlsPublicPath,
  hlsVideoOutputDir,
  resolveHlsPublicUrl,
  resolveSourcePath,
  sanitizeVideoId,
} from "@/lib/media/hls/paths";
import type {
  HlsQualityLabel,
  HlsQualityPreset,
  HlsTranscodeOptions,
  HlsTranscodeResult,
} from "@/lib/media/hls/types";

export const DEFAULT_HLS_SEGMENT_SECONDS = 3;

/** Qualities ordered for 720p-first playback (ABR can step down to 360p). */
export const HLS_QUALITY_PRESETS: HlsQualityPreset[] = [
  {
    label: "720p",
    height: 720,
    videoBitrate: "2800k",
    audioBitrate: "128k",
    maxWidth: 1280,
  },
  {
    label: "360p",
    height: 360,
    videoBitrate: "800k",
    audioBitrate: "96k",
    maxWidth: 640,
  },
];

function clampSegmentSeconds(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return DEFAULT_HLS_SEGMENT_SECONDS;
  }
  return Math.min(4, Math.max(2, Math.round(value)));
}

function runFfmpeg(args: string[], onProgress?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      if (onProgress && line.includes("time=")) {
        onProgress(line.trim());
      }
    });

    child.on("error", (err) => {
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function gopSize(fps: number, segmentSeconds: number): number {
  return Math.max(24, Math.round(fps * segmentSeconds));
}

function scaleFilter(preset: HlsQualityPreset): string {
  return `scale=w=min(${preset.maxWidth}\\,iw):h=${preset.height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

async function transcodeQualityRendition(params: {
  sourcePath: string;
  outputDir: string;
  preset: HlsQualityPreset;
  segmentSeconds: number;
  fps: number;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const { sourcePath, outputDir, preset, segmentSeconds, fps, onProgress } =
    params;

  const qualityDir = path.join(outputDir, preset.label);
  fs.mkdirSync(qualityDir, { recursive: true });

  const segmentPattern = path.join(qualityDir, "seg_%03d.ts");
  const playlistPath = path.join(qualityDir, "index.m3u8");
  const gop = gopSize(fps, segmentSeconds);

  const args = [
    "-hide_banner",
    "-y",
    "-i",
    sourcePath,
    "-vf",
    scaleFilter(preset),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    preset.label === "360p" ? "baseline" : "main",
    "-level",
    preset.label === "360p" ? "3.0" : "4.0",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    preset.videoBitrate,
    "-maxrate",
    preset.videoBitrate,
    "-bufsize",
    `${Math.round(Number.parseInt(preset.videoBitrate, 10) * 2)}k`,
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    "-force_key_frames",
    `expr:gte(t,n_forced*${segmentSeconds})`,
    "-c:a",
    "aac",
    "-b:a",
    preset.audioBitrate,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_list_size",
    "0",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "independent_segments+program_date_time+temp_file",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ];

  await runFfmpeg(args, onProgress);
}

function bandwidthForPreset(preset: HlsQualityPreset): number {
  const video = Number.parseInt(preset.videoBitrate, 10) * 1000;
  const audio = Number.parseInt(preset.audioBitrate, 10) * 1000;
  return video + audio;
}

function resolutionForPreset(
  preset: HlsQualityPreset,
  probeWidth: number,
  probeHeight: number,
): { width: number; height: number } {
  if (probeWidth <= 0 || probeHeight <= 0) {
    return { width: preset.maxWidth, height: preset.height };
  }
  const scale = Math.min(
    preset.maxWidth / probeWidth,
    preset.height / probeHeight,
    1,
  );
  const width = Math.max(2, Math.floor((probeWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.floor((probeHeight * scale) / 2) * 2);
  return { width, height };
}

function writeMasterPlaylist(params: {
  outputDir: string;
  presets: HlsQualityPreset[];
  probeWidth: number;
  probeHeight: number;
}): void {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];

  for (const preset of params.presets) {
    const { width, height } = resolutionForPreset(
      preset,
      params.probeWidth,
      params.probeHeight,
    );
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidthForPreset(preset)},RESOLUTION=${width}x${height},CODECS="avc1.42E01E,mp4a.40.2"`,
      `${preset.label}/index.m3u8`,
    );
  }

  fs.writeFileSync(
    path.join(params.outputDir, "master.m3u8"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

/**
 * Full-source HLS ladder (360p + 720p). Timeline starts at t=0 of `sourcePath`
 * so `clean-clips.json` `startMs`/`endMs` map to `currentTime * 1000` in hls.js.
 */
export async function transcodeToHls(
  options: HlsTranscodeOptions,
): Promise<HlsTranscodeResult> {
  const videoId = sanitizeVideoId(options.videoId);
  if (!videoId) {
    throw new Error(`Invalid videoId: ${options.videoId}`);
  }

  const sourcePath = resolveSourcePath(options.sourcePath);
  const segmentSeconds = clampSegmentSeconds(options.segmentSeconds);
  const outputDir = options.outputRoot
    ? path.join(options.outputRoot, videoId)
    : hlsVideoOutputDir(videoId);

  fs.mkdirSync(outputDir, { recursive: true });

  const probe = await probeVideo(sourcePath);
  const fps = probe.fps > 0 && probe.fps < 120 ? probe.fps : 24;

  options.onProgress?.(
    `Probed ${videoId}: ${probe.durationMs}ms @ ${fps.toFixed(3)}fps`,
  );

  for (const preset of HLS_QUALITY_PRESETS) {
    options.onProgress?.(`Encoding ${videoId} ${preset.label}…`);
    await transcodeQualityRendition({
      sourcePath,
      outputDir,
      preset,
      segmentSeconds,
      fps,
      onProgress: options.onProgress,
    });
  }

  writeMasterPlaylist({
    outputDir,
    presets: HLS_QUALITY_PRESETS,
    probeWidth: probe.width,
    probeHeight: probe.height,
  });

  const masterPlaylistPath = path.join(outputDir, "master.m3u8");

  return {
    videoId,
    outputDir,
    masterPlaylistPath,
    masterPlaylistUrl: resolveHlsPublicUrl(videoId, "master.m3u8"),
    qualities: HLS_QUALITY_PRESETS.map((p) => p.label),
    segmentSeconds,
    sourceDurationMs: probe.durationMs,
    fps,
  };
}

export function readMasterPlaylistRelativeUrls(videoId: string): HlsQualityLabel[] {
  const masterPath = hlsMasterPlaylistPath(videoId);
  const content = fs.readFileSync(masterPath, "utf8");
  const qualities: HlsQualityLabel[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "360p/index.m3u8") qualities.push("360p");
    if (trimmed === "720p/index.m3u8") qualities.push("720p");
  }
  return qualities;
}

export { hlsPublicPath };
