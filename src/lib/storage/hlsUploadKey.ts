import { hlsCdnKeyPrefix } from "@/lib/media/hls/pathsShared";
import {
  pad2,
  pad3,
  sanitizeUploadFilename,
  slugContentTitle,
} from "@/lib/storage/mediaUploadKey";

/** How HLS objects are grouped under `hls/` on Arvan. */
export type HlsCatalogLayoutKind = "series" | "standalone";

export type BuildHlsCatalogPackagePathOptions = {
  contentTitle: string;
  layout: HlsCatalogLayoutKind;
  season: number;
  episode: number;
  part: number;
  localFolderName: string;
};

function sanitizeHlsPathSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function sanitizeHlsRelativeSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Folder path under `hls/` (no `hls/` prefix):
 * - series: `{title}/S{ss}/E{ee}/P{ppp}/{localFolder}`
 * - standalone (movie / documentary): `{title}/P{ppp}/{localFolder}`
 */
export function buildHlsCatalogPackagePath(
  options: BuildHlsCatalogPackagePathOptions,
): string | null {
  const slug = slugContentTitle(options.contentTitle.trim() || "media");
  const safeFolder =
    sanitizeUploadFilename(options.localFolderName.trim() || "clip") || "clip";
  const partSeg = `P${pad3(options.part)}`;

  if (options.layout === "series") {
    if (options.season < 1 || options.episode < 1) return null;
    return [
      slug,
      `S${pad2(options.season)}`,
      `E${pad2(options.episode)}`,
      partSeg,
      safeFolder,
    ].join("/");
  }

  return [slug, partSeg, safeFolder].join("/");
}

/** @deprecated Use {@link buildHlsCatalogPackagePath}. Legacy flat package id. */
export function buildHlsPackageCdnId(options: {
  uuid: string;
  contentTitle: string;
  season: number;
  episode: number;
  part: number;
  localFolderName: string;
}): string | null {
  const layout: HlsCatalogLayoutKind =
    options.season >= 1 && options.episode >= 1 ? "series" : "standalone";
  return buildHlsCatalogPackagePath({
    contentTitle: options.contentTitle,
    layout,
    season: options.season,
    episode: options.episode,
    part: options.part,
    localFolderName: options.localFolderName,
  });
}

/** S3 object key for a file inside an HLS package, e.g. `hls/friends/S01/E05/P003/clip1/master.m3u8`. */
export function buildHlsUploadKey(
  catalogPackagePath: string,
  relativeWithinPackage: string,
): string | null {
  const base = catalogPackagePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map(sanitizeHlsPathSegment)
    .filter(Boolean)
    .join("/");
  if (!base) return null;

  const rel = relativeWithinPackage
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map(sanitizeHlsRelativeSegment)
    .filter(Boolean)
    .join("/");
  if (!rel) return null;
  return `${hlsCdnKeyPrefix(base)}/${rel}`;
}

/** Prefix for listing / skip-existing checks, e.g. `hls/friends/S01/E05/P003/clip1`. */
export function hlsCatalogPrefix(catalogPackagePath: string): string | null {
  const built = buildHlsUploadKey(catalogPackagePath, "master.m3u8");
  if (!built) return null;
  const i = built.lastIndexOf("/");
  return i > 0 ? built.slice(0, i) : built;
}

/** List once per title when skipping existing HLS uploads (all parts under `hls/{slug}/`). */
export function hlsTitleCatalogPrefix(contentTitle: string): string {
  return `hls/${slugContentTitle(contentTitle.trim() || "media")}`;
}

/** True for deprecated single-segment keys like `{uuid}_{title}_S00_E00_P001_folder`. */
export function isLegacyFlatHlsPackageSegment(segment: string): boolean {
  if (!segment || segment.includes("/")) return false;
  if (segment.includes("the_pursuit_of_happiness_S00_E00")) return true;
  if (/^[0-9a-f-]{36}_/i.test(segment) && /_S\d{2}_E\d{2}_P\d{3}_/i.test(segment)) {
    return true;
  }
  if (/_S00_E00_/i.test(segment)) return true;
  return false;
}

export function isLegacyHlsObjectKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, "");
  if (!normalized.startsWith("hls/")) return false;
  const rest = normalized.slice("hls/".length);
  const first = rest.split("/")[0] ?? "";
  return isLegacyFlatHlsPackageSegment(first);
}
