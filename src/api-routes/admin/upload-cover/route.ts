import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import {
  buildMediaPublicUrl,
  createMediaS3Client,
  getS3Bucket,
  mediaPutObjectAclFields,
} from "@/lib/storage/cloud-s3";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function extensionForType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

/**
 * POST /api/admin/upload-cover
 * multipart form: file
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const contentType = file.type || "image/jpeg";
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const ext = extensionForType(contentType);
  const key = `covers/admin/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const client = createMediaS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ...mediaPutObjectAclFields(),
    }),
  );

  return NextResponse.json({ url: buildMediaPublicUrl(key) });
}
