import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const DEBUG_AUDIO_DIR = path.join(process.cwd(), "debug");
const MAX_DEEPGRAM_KEYTERMS = 100;

/** Reject obviously invalid uploads before calling Deepgram. */
const MIN_AUDIO_BYTES = 128;
/** Deepgram sync listen times out on large uploads (~408). */
const MAX_AUDIO_BYTES = 512 * 1024;

function mapLang(lang: string | null): string {
  if (!lang) return "en";
  const base = lang.split("-")[0]?.toLowerCase() ?? "en";
  return base === "en" ? "en" : base;
}

function resolveContentType(
  audio: Blob,
  mimetypeField: FormDataEntryValue | null,
): string {
  if (typeof mimetypeField === "string" && mimetypeField.trim()) {
    return mimetypeField.trim();
  }
  if (audio.type?.trim()) return audio.type.trim();
  return "audio/webm";
}

function deepgramErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.err_msg === "string") return record.err_msg;
  if (typeof record.message === "string") return record.message;
  return undefined;
}

function parseExpectedPhrases(field: FormDataEntryValue | null): string[] {
  if (typeof field !== "string" || !field.trim()) return [];

  try {
    const parsed: unknown = JSON.parse(field);
    if (!Array.isArray(parsed)) return [];

    const phrases: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      phrases.push(trimmed);
      if (phrases.length >= MAX_DEEPGRAM_KEYTERMS) break;
    }
    return phrases;
  } catch {
    return [];
  }
}

function debugAudioExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("wav")) return "wav";
  return "bin";
}

async function writeDebugRetryAudio(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await fs.mkdir(DEBUG_AUDIO_DIR, { recursive: true });
  const filePath = path.join(
    DEBUG_AUDIO_DIR,
    `retry-${Date.now()}.${debugAudioExtension(contentType)}`,
  );
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * POST /api/speech/deepgram/transcribe
 * Prerecorded fallback transcription for Web Speech retry (multipart `audio` field).
 */
export async function POST(request: Request) {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  if (audio.size < MIN_AUDIO_BYTES) {
    return NextResponse.json({ error: "audio_too_short" }, { status: 400 });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "[deepgram/transcribe] audio too large:",
        audio.size,
        "bytes",
      );
    }
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }

  const lang = mapLang(
    typeof formData.get("lang") === "string"
      ? (formData.get("lang") as string)
      : null,
  );
  const contentType = resolveContentType(audio, formData.get("mimetype"));
  const expectedPhrases = parseExpectedPhrases(formData.get("expectedPhrases"));

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());

    const debugPath = await writeDebugRetryAudio(buffer, contentType);

    const params = new URLSearchParams({
      model: "nova-3",
      smart_format: "true",
      language: lang,
    });
    for (const phrase of expectedPhrases) {
      params.append("keyterm", phrase);
    }

    const dgResponse = await fetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: buffer,
      },
    );

    const payload: unknown = await dgResponse.json().catch(() => null);

    if (!dgResponse.ok) {
      const detail = deepgramErrorMessage(payload);
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[deepgram/transcribe] failed:",
          dgResponse.status,
          detail ?? payload,
        );
      }
      return NextResponse.json(
        {
          error: "transcribe_failed",
          ...(detail ? { detail } : {}),
        },
        { status: 502 },
      );
    }

    const result = payload as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
          }>;
        }>;
      };
    };

    const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim() ?? "";
    const confidence = alternative?.confidence;

    return NextResponse.json({
      transcript,
      ...(confidence !== undefined ? { confidence } : {}),
    });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[deepgram/transcribe] unexpected error:", err);
    }
    return NextResponse.json({ error: "transcribe_failed" }, { status: 502 });
  }
}
