import {
  buildHlsCatalogPackagePath,
  hlsCatalogPrefix,
  type HlsCatalogLayoutKind,
} from "@/lib/storage/hlsUploadKey";
import {
  pad2,
  pad3,
  sanitizeUploadFilename,
  slugContentTitle,
} from "@/lib/storage/mediaUploadKey";

const UUID_SEGMENT =
  "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";

function objectDirname(key: string): string {
  const i = key.lastIndexOf("/");
  return i > 0 ? key.slice(0, i) : "";
}

function leafName(key: string): string {
  const i = key.lastIndexOf("/");
  return i >= 0 ? key.slice(i + 1) : key;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find a catalog object for the same folder + title / S / E / P / filename
 * (leaf: uuid_titleSlug_S##_E##_P###_file). Any UUID counts as a match.
 */
export function findExistingCatalogKey(
  objectDirectory: string,
  originalFilename: string,
  catalogKeys: Set<string> | ReadonlySet<string>,
  structuredMatch: {
    titleSlug: string;
    season: number;
    episode: number;
    part: number;
  }
): string | null {
  const slug = slugContentTitle(structuredMatch.titleSlug);
  const safe = sanitizeUploadFilename(originalFilename);
  const leafRe = new RegExp(
    `^${UUID_SEGMENT}_${escapeRegExp(slug)}_S${pad2(structuredMatch.season)}_E${pad2(structuredMatch.episode)}_P${pad3(structuredMatch.part)}_${escapeRegExp(safe)}$`,
    "i"
  );

  for (const key of catalogKeys) {
    if (objectDirname(key) !== objectDirectory) continue;
    if (leafRe.test(leafName(key))) return key;
  }

  /** Legacy hyphen form in the same folder: {uuid}-{safeName}. */
  const safeLegacy = sanitizeUploadFilename(originalFilename);
  for (const key of catalogKeys) {
    if (objectDirname(key) !== objectDirectory) continue;
    const leaf = leafName(key);
    const hyphen = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-(.+)$/i.exec(
      leaf
    );
    if (hyphen?.[2] === safeLegacy) return key;
    if (leaf === safeLegacy) return key;
  }

  return null;
}

/** Whether `master.m3u8` already exists for a hierarchical HLS package on CDN. */
export function hlsPackageExistsInCatalog(
  catalogKeys: Set<string> | ReadonlySet<string>,
  options: {
    contentTitle: string;
    layout: HlsCatalogLayoutKind;
    season: number;
    episode: number;
    part: number;
    localFolderName: string;
  },
): boolean {
  const path = buildHlsCatalogPackagePath({
    contentTitle: options.contentTitle,
    layout: options.layout,
    season: options.season,
    episode: options.episode,
    part: options.part,
    localFolderName: options.localFolderName,
  });
  if (!path) return false;
  const prefix = hlsCatalogPrefix(path);
  if (!prefix) return false;
  const masterKey = `${prefix}/master.m3u8`;
  for (const key of catalogKeys) {
    if (key === masterKey || key.endsWith(`/${masterKey}`)) return true;
  }
  return false;
}
