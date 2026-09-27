import fs from "node:fs";
import path from "node:path";

import { sanitizeVideoId } from "@/lib/media/hls/pathsShared";

export {
  hlsCdnKeyPrefix,
  hlsPublicPath,
  resolveHlsPublicUrl,
  sanitizeVideoId,
} from "@/lib/media/hls/pathsShared";

export function hlsOutputRoot(): string {
  const configured = process.env.HLS_OUTPUT_ROOT?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), "public/media/hls");
}

export function hlsVideoOutputDir(videoId: string): string {
  const safe = sanitizeVideoId(videoId);
  if (!safe) {
    throw new Error(`Invalid videoId: ${videoId}`);
  }
  return path.join(hlsOutputRoot(), safe);
}

export function hlsMasterPlaylistPath(videoId: string): string {
  return path.join(hlsVideoOutputDir(videoId), "master.m3u8");
}

export function hlsQualityPlaylistPath(
  videoId: string,
  quality: "360p" | "720p",
): string {
  return path.join(hlsVideoOutputDir(videoId), quality, "index.m3u8");
}

export function isHlsPackageReady(videoId: string): boolean {
  const master = hlsMasterPlaylistPath(videoId);
  if (!fs.existsSync(master)) {
    return false;
  }
  for (const q of ["360p", "720p"] as const) {
    if (!fs.existsSync(hlsQualityPlaylistPath(videoId, q))) {
      return false;
    }
  }
  return true;
}

export function resolveSourcePath(sourcePath: string): string {
  const trimmed = sourcePath.trim();
  if (!trimmed) {
    throw new Error("sourcePath is required");
  }
  const resolved = path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(process.cwd(), trimmed);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Source video not found: ${resolved}`);
  }
  return resolved;
}
