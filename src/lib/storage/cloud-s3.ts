import { isLegacyHlsObjectKey } from "@/lib/storage/hlsUploadKey";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

export function getS3Bucket(): string {
  return requireEnv("CLOUD_BUCKET_NAME");
}

export function createMediaS3Client(): S3Client {
  const endpoint = requireEnv("CLOUD_ENDPOINT").replace(/\/$/, "");
  const accessKeyId = requireEnv("CLOUD_ACCESS_KEY");
  const secretAccessKey = requireEnv("CLOUD_SECRET_KEY");
  const region = process.env.CLOUD_REGION?.trim() || "default";
  const forcePathStyle = process.env.CLOUD_FORCE_PATH_STYLE !== "false";

  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  });
}

/**
 * When `true`, the object key becomes a single path segment with "/" encoded as %2F
 * (matches Arvan / some S3 public URL shapes), e.g.
 * `{base}/clips%2Ffriends_s01e01%2Fuuid-clip_1.mp4`
 */
export function shouldEncodePublicKeySegment(): boolean {
  const v =
    process.env.CLOUD_PUBLIC_URL_ENCODE_FULL_KEY_PATH?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Append decoded key either as normal multi-segment path or single encoded segment (see env above). */
function joinPublicBase(baseRaw: string, keyDecoded: string): string {
  const base = baseRaw.replace(/\/$/, "");
  if (shouldEncodePublicKeySegment()) {
    return `${base}/${encodeURIComponent(keyDecoded)}`;
  }
  return `${base}/${keyDecoded}`;
}

/**
 * Public URL used in the app (covers, `Part.url`, etc.).
 * Prefer `CLOUD_PUBLIC_BASE_URL` (bucket root) if your CDN shape differs
 * (e.g. `https://${bucket}.s3....arvanstorage.ir`).
 * Set `CLOUD_PUBLIC_URL_ENCODE_FULL_KEY_PATH=true` if the CDN expects the key as one encoded segment.
 */
const MEDIA_HLS_PREFIX = process.env.MEDIA_HLS_PREFIX ?? "hls";
export function buildMediaPublicUrl(key: string): string {
  const k = key.replace(/^\/+/, "");
  const explicit = process.env.CLOUD_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (explicit) {
    return joinPublicBase(explicit, k);
  }
  const mediaBase = process.env.MEDIA_BASE_URL?.trim().replace(/\/$/, "");
  if (mediaBase && /^https?:\/\//i.test(mediaBase)) {
    return joinPublicBase(mediaBase, k);
  }
  const hot = process.env.CLOUD_ENDPOINT?.replace(/\/$/, "");
  const bucket = getS3Bucket();
  if (hot) {
    return joinPublicBase(`${hot}/${bucket}`, k);
  }
  const endpoint = requireEnv("CLOUD_ENDPOINT").replace(/\/$/, "");
  return joinPublicBase(`${endpoint}/${bucket}`, k);
}

/** Canned ACL for anonymous CDN/browser GET (Arvan S3-compatible). */
export const S3_ACL_PUBLIC_READ = "public-read" as const;

/**
 * Set `CLOUD_PUT_OBJECT_PUBLIC_READ=false` when the bucket rejects canned ACL (use a public-read bucket policy instead).
 */
export function wantPublicReadAcl(): boolean {
  const v = process.env.CLOUD_PUT_OBJECT_PUBLIC_READ?.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

/** ACL field for server-side `PutObject` (admin upload-cover, etc.). */
export function mediaPutObjectAclFields(
  publicRead?: boolean,
): { ACL: typeof S3_ACL_PUBLIC_READ } | Record<string, never> {
  const apply = publicRead ?? wantPublicReadAcl();
  return apply ? { ACL: S3_ACL_PUBLIC_READ } : {};
}

/**
 * Headers the browser must send on a presigned PUT when ACL is signed.
 * Without `x-amz-acl`, Arvan/S3 stores the object as private despite the presign.
 */
export function presignedPutUploadHeaders(
  contentType: string,
  publicRead: boolean,
  cacheControl?: string,
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (publicRead) {
    headers["x-amz-acl"] = S3_ACL_PUBLIC_READ;
  }
  if (cacheControl) {
    headers["Cache-Control"] = cacheControl;
  }
  return headers;
}

/** Safe S3 object key (no `..`, limited charset). */
export function sanitizeMediaObjectKey(key: string): string | null {
  const s = key.replace(/^\/+/, "").trim();
  if (!s || s.includes("..") || s.length > 1024) return null;
  if (!/^[a-zA-Z0-9/_.-]+$/.test(s)) return null;
  return s;
}

/**
 * Server-side PutObject — use from `/api/media/put` so the browser never talks to Arvan directly.
 * Sets `public-read` ACL when enabled (same as presigned PUT).
 */
export async function putMediaObject(
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string,
  opts?: { publicRead?: boolean; cacheControl?: string },
): Promise<void> {
  const safeKey = sanitizeMediaObjectKey(key);
  if (!safeKey) {
    throw new Error(`Invalid object key: ${key}`);
  }
  const buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body);

  const client = createMediaS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: safeKey,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: contentType,
      ...(opts?.cacheControl ? { CacheControl: opts.cacheControl } : {}),
      ...mediaPutObjectAclFields(opts?.publicRead ?? true),
    }),
  );
}

/** Apply bucket CORS so browser presigned PUT works (optional if using server upload). */
export async function putBucketCorsRules(
  client: S3Client,
  rules: CORSRule[],
): Promise<void> {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: getS3Bucket(),
      CORSConfiguration: { CORSRules: rules },
    }),
  );
}

export function defaultMediaBucketCorsRules(
  allowedOrigins: string[],
): CORSRule[] {
  const origins = [
    ...new Set(allowedOrigins.map((o) => o.trim()).filter(Boolean)),
  ];
  if (origins.length === 0) {
    origins.push("http://localhost:3000");
  }
  return [
    {
      AllowedHeaders: ["*"],
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedOrigins: origins,
      ExposeHeaders: ["ETag", "Content-Length"],
      MaxAgeSeconds: 3600,
    },
  ];
}

export async function presignMediaPut(
  client: S3Client,
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
  opts?: { publicRead?: boolean; cacheControl?: string },
): Promise<string> {
  const publicRead = opts?.publicRead ?? wantPublicReadAcl();
  const unhoistable = new Set<string>();
  if (publicRead) {
    unhoistable.add("x-amz-acl");
  }
  if (opts?.cacheControl) {
    unhoistable.add("cache-control");
  }
  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: key,
    ContentType: contentType,
    ...(opts?.cacheControl ? { CacheControl: opts.cacheControl } : {}),
    ...mediaPutObjectAclFields(publicRead),
  });
  return getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
    ...(unhoistable.size > 0 ? { unhoistableHeaders: unhoistable } : {}),
  });
}

export async function listAllObjectKeysUnderPrefix(
  client: S3Client,
  prefix: string,
  maxTotal = 25_000,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  const pfx = prefix.replace(/^\/+/, "");
  while (out.length < maxTotal) {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: getS3Bucket(),
        Prefix: pfx,
        ContinuationToken: token,
        MaxKeys: Math.min(1000, maxTotal - out.length),
      }),
    );
    for (const c of res.Contents ?? []) {
      if (c.Key && !c.Key.endsWith("/")) {
        out.push(c.Key);
      }
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    token = res.NextContinuationToken;
  }
  return out;
}

const DELETE_BATCH_SIZE = 1000;

/** Delete object keys (no-op when empty). Returns count deleted. */
export async function deleteMediaObjectKeys(
  client: S3Client,
  keys: string[],
): Promise<number> {
  if (keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: getS3Bucket(),
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += (res.Deleted ?? []).length;
  }
  return deleted;
}

/** List legacy flat HLS package keys under `hls/` (e.g. `*_S00_E00_*` single segment). */
export async function listLegacyHlsObjectKeys(
  client: S3Client,
  maxTotal = 50_000,
): Promise<string[]> {
  const all = await listAllObjectKeysUnderPrefix(client, "hls/", maxTotal);
  return all.filter(isLegacyHlsObjectKey);
}
