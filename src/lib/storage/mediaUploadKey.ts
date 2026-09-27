export type UploadKindKey = "cover" | "clip" | "misc";

const PREFIX: Record<UploadKindKey, string> = {
  cover: "covers",
  clip: "clips",
  misc: "uploads",
};

export function sanitizeUploadFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "").trim() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export function sanitizeUploadRelativeDirectories(rel: string): string[] {
  if (!rel.trim()) return [];
  return rel
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120))
    .filter(Boolean)
    .slice(0, 24);
}

export function slugContentTitle(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return slug || "media";
}

/** DB `videos.tag` — same rules as CDN title slug (Friends → friends). */
export function videoTagFromName(name: string): string {
  return slugContentTitle(name);
}

export function pad2(n: number): string {
  const x = Math.max(0, Math.min(99, Number.isFinite(n) ? Math.floor(n) : 0));
  return x.toString().padStart(2, "0");
}

export function pad3(n: number): string {
  const x = Math.max(0, Math.min(999, Number.isFinite(n) ? Math.floor(n) : 0));
  return x.toString().padStart(3, "0");
}

/** For UI / uploads: derive part index from basename when possible (clip_03, part-12). */
export function inferPartNumberFromBasename(filename: string): number | null {
  const lower = filename.toLowerCase().replace(/^.*[/\\]/, "");
  let m = /(?:^|[._-])(?:clip|c|segment|scene|part)[_\-]?(\d{1,3})\b/i.exec(lower);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    if (n >= 1) return Math.min(n, 999);
  }
  m = /^(\d{1,3})[._-]/.exec(lower);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 999) return n;
  }
  return null;
}

function kindPrefix(kind: UploadKindKey): string {
  return PREFIX[kind];
}

/** Directory prefix inside the bucket, e.g. `clips/foo/bar` without trailing slash. */
export function buildUploadObjectDirectory(
  kind: UploadKindKey,
  relativeDirectory: string
): string {
  const dirs = sanitizeUploadRelativeDirectories(relativeDirectory);
  return dirs.length ? `${kindPrefix(kind)}/${dirs.join("/")}` : kindPrefix(kind);
}

/** Public-friendly leaf after UUID prefix: `{uuid}_{slug}_S{ss}_E{ee}_P{ppp}_{safeName}` */
export function buildStructuredLeafName(options: {
  uuid: string;
  titleSlug: string;
  season: number;
  episode: number;
  part: number;
  sanitizedFilename: string;
}): string {
  const uuid = options.uuid.trim().replace(/[^a-fA-F0-9-]/g, "");
  const slug = options.titleSlug.trim() ? slugContentTitle(options.titleSlug) : "media";
  const safeName = sanitizeUploadFilename(options.sanitizedFilename);
  return `${uuid}_${slug}_S${pad2(options.season)}_E${pad2(options.episode)}_P${pad3(options.part)}_${safeName}`;
}

export function buildStructuredUploadKey(
  kind: UploadKindKey,
  relativeDirectory: string,
  structuredLeaf: string
): string {
  const dir = buildUploadObjectDirectory(kind, relativeDirectory);
  return `${dir}/${structuredLeaf}`;
}

export function uploadKindFromBatchMode(images: boolean): UploadKindKey {
  return images ? "cover" : "clip";
}
