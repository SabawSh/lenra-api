import { NextResponse } from "next/server";

import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";
import {
  createMediaS3Client,
  listAllObjectKeysUnderPrefix,
} from "@/lib/storage/cloud-s3";
import type { JsonValue } from "@/types/json";

/** Max keys returned (paginated on the server) to keep memory bounded. */
const MAX_KEYS_DEFAULT = 25_000;

function sanitizeListPrefix(input: JsonValue | undefined): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/^\/+/, "");
  if (!s || s.includes("..")) return null;
  if (s.length > 920) return null;
  if (!/^[a-zA-Z0-9/_.-]+$/.test(s)) return null;
  return s;
}

/**
 * POST /api/media/catalog
 * Body: { prefix?: string }
 * Lists object keys under a prefix via S3 (Arvan-compatible). Used to skip uploads.
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let body: JsonValue;
  try {
    body = (await req.json()) as JsonValue;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, JsonValue>) : {};
  const prefix = sanitizeListPrefix(b.prefix ?? "clips/");
  if (!prefix) {
    return NextResponse.json({ error: "Invalid prefix" }, { status: 400 });
  }

  const rawMax = b.maxTotal;
  const maxTotal =
    typeof rawMax === "number" && Number.isFinite(rawMax)
      ? Math.min(Math.max(1, Math.floor(rawMax)), MAX_KEYS_DEFAULT)
      : MAX_KEYS_DEFAULT;

  try {
    const client = createMediaS3Client();
    const keys = await listAllObjectKeysUnderPrefix(client, prefix, maxTotal);

    return NextResponse.json({
      prefix,
      keys,
      /** True when the cap was reached; more objects may exist beyond this page. */
      truncated: keys.length >= maxTotal,
      count: keys.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "List failed";
    console.error("[media/catalog]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
