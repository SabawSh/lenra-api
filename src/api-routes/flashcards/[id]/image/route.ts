import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  getPersonalFlashcardById,
  insertFlashcardEvent,
  personalFlashcardToJson,
  updatePersonalFlashcard,
} from "@/lib/db/queries/personalFlashcards";
import {
  buildMediaPublicUrl,
  createMediaS3Client,
  getS3Bucket,
  putObjectWithAclFallback,
} from "@/lib/storage/cloud-s3";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;

    const existing = await getPersonalFlashcardById(auth.user.id, id);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
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
    const key = `flashcards/${auth.user.id}/${randomUUID()}.${ext}`;
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
      console.error("[flashcards/image] S3 error", e);
      return NextResponse.json(
        { error: "Storage upload failed. Please try again." },
        { status: 502 },
      );
    }

    const imageUrl = buildMediaPublicUrl(key);
    const card = await updatePersonalFlashcard(auth.user.id, id, {
      imageUrl,
      imageSource: "user_upload",
    });

    await insertFlashcardEvent({
      userId: auth.user.id,
      flashcardId: id,
      eventType: "updated",
      payload: { image: true },
    });

    return NextResponse.json({
      success: true,
      imageUrl,
      card: card ? personalFlashcardToJson(card) : null,
    });
  } catch (err) {
    console.error("[flashcards] image upload error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
