import fs from "node:fs";

import { HLS_QUALITY_PRESETS } from "@/lib/media/ffmpeg/hls";
import { probeVideo } from "@/lib/media/ffmpeg/probe";
import {
  hlsMasterPlaylistPath,
  hlsQualityPlaylistPath,
  isHlsPackageReady,
  resolveHlsPublicUrl,
  sanitizeVideoId,
} from "@/lib/media/hls/paths";
import type {
  HlsQualityLabel,
  PlaybackManifest,
  PlaybackQualityInfo,
} from "@/lib/media/hls/types";

function parseBandwidthFromMaster(masterContent: string, label: HlsQualityLabel): number {
  const needle = `${label}/index.m3u8`;
  const lines = masterContent.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim() === needle) {
      const prev = lines[i - 1] ?? "";
      const match = prev.match(/BANDWIDTH=(\d+)/);
      if (match?.[1]) {
        return Number.parseInt(match[1], 10);
      }
    }
  }
  const preset = HLS_QUALITY_PRESETS.find((p) => p.label === label);
  if (!preset) return 1_000_000;
  const video = Number.parseInt(preset.videoBitrate, 10) * 1000;
  const audio = Number.parseInt(preset.audioBitrate, 10) * 1000;
  return video + audio;
}

function parseResolutionFromMaster(
  masterContent: string,
  label: HlsQualityLabel,
): { width: number; height: number } {
  const needle = `${label}/index.m3u8`;
  const lines = masterContent.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim() === needle) {
      const prev = lines[i - 1] ?? "";
      const match = prev.match(/RESOLUTION=(\d+)x(\d+)/);
      if (match?.[1] && match[2]) {
        return {
          width: Number.parseInt(match[1], 10),
          height: Number.parseInt(match[2], 10),
        };
      }
    }
  }
  const preset = HLS_QUALITY_PRESETS.find((p) => p.label === label);
  return { width: preset?.maxWidth ?? 640, height: preset?.height ?? 360 };
}

function readSegmentSeconds(videoId: string): number {
  const playlistPath = hlsQualityPlaylistPath(videoId, "360p");
  if (!fs.existsSync(playlistPath)) {
    return 3;
  }
  const content = fs.readFileSync(playlistPath, "utf8");
  const match = content.match(/#EXTINF:([\d.]+)/);
  if (match?.[1]) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return 3;
}

/**
 * Playback manifest for hls.js — 720p is listed first in master; ABR falls back to 360p.
 */
export function getPlaybackManifest(videoId: string): PlaybackManifest | null {
  const safe = sanitizeVideoId(videoId);
  if (!safe || !isHlsPackageReady(safe)) {
    return null;
  }

  const masterPath = hlsMasterPlaylistPath(safe);
  const masterContent = fs.readFileSync(masterPath, "utf8");
  const segmentSeconds = readSegmentSeconds(safe);

  const qualities: PlaybackQualityInfo[] = (["720p", "360p"] as const).map(
    (label) => {
      const { width, height } = parseResolutionFromMaster(masterContent, label);
      return {
        label,
        playlistUrl: resolveHlsPublicUrl(safe, `${label}/index.m3u8`),
        bandwidth: parseBandwidthFromMaster(masterContent, label),
        width,
        height,
      };
    },
  );

  const estimatedStartupMs = Math.min(
    1000,
    Math.round(180 + segmentSeconds * 120),
  );

  return {
    videoId: safe,
    masterPlaylistUrl: resolveHlsPublicUrl(safe, "master.m3u8"),
    qualities,
    estimatedStartupMs,
    segmentSeconds,
    sourceDurationMs: null,
    subtitleTimebase: {
      unit: "milliseconds",
      mediaOrigin: "source_start",
      hlsPresentation: "seconds_from_zero",
      aligned: true,
    },
    ready: true,
  };
}

/**
 * Same as {@link getPlaybackManifest} but probes source duration when `sourcePath` exists.
 */
export async function getPlaybackManifestWithProbe(
  videoId: string,
  sourcePath?: string,
): Promise<PlaybackManifest | null> {
  const manifest = getPlaybackManifest(videoId);
  if (!manifest || !sourcePath?.trim()) {
    return manifest;
  }

  try {
    const probe = await probeVideo(sourcePath);
    return { ...manifest, sourceDurationMs: probe.durationMs };
  } catch {
    return manifest;
  }
}

/**
 * Maps clean-clips `startMs` to HTMLMediaElement `currentTime` for HLS full-source streams.
 */
export function subtitleMsToPlaybackSeconds(startMs: number): number {
  return Math.max(0, startMs) / 1000;
}
