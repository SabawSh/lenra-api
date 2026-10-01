import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { updateUserAvatarUrl } from "@/lib/db/queries/users";
import {
  buildMediaPublicUrl,
  createMediaS3Client,
  getS3Bucket,
  putObjectWithAclFallback,
} from "@/lib/storage/cloud-s3";
import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const contentType = file.type || "image/jpeg";
  if (!ALLOWED.has(contentType)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG and WebP images are allowed" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be smaller than 5 MB" },
      { status: 400 },
    );
  }

  const ext = EXT[contentType] ?? "jpg";
  const key = `avatars/${user.id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const client = createMediaS3Client();
    await putObjectWithAclFallback(client, {
      Bucket: getS3Bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
  } catch (e) {
    console.error("[avatar/upload] S3 error", e);
    const detail =
      process.env.NODE_ENV === "development" && e instanceof Error
        ? e.message.slice(0, 200)
        : undefined;
    return NextResponse.json(
      {
        error: "Storage upload failed. Please try again.",
        ...(detail ? { detail } : {}),
      },
      { status: 502 },
    );
  }

  const avatarUrl = buildMediaPublicUrl(key);

  await updateUserAvatarUrl(user.id, avatarUrl);

  try {
    revalidateTag("user", { expire: 0 });
  } catch (e) {
    console.warn("[avatar/upload] revalidateTag skipped", e);
  }
  return NextResponse.json({ ok: true, avatarUrl });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await updateUserAvatarUrl(user.id, null);

  try {
    revalidateTag("user", { expire: 0 });
  } catch (e) {
    console.warn("[avatar/remove] revalidateTag skipped", e);
  }

  return NextResponse.json({ ok: true, avatarUrl: null });
}
