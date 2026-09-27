import { createClient, DeepgramApiError } from "@deepgram/sdk";
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Short-lived JWT for browser WebSocket auth — never expose the master API key. */
const TOKEN_TTL_SECONDS = 120;

/**
 * POST /api/speech/deepgram/token
 * Issues a temporary Deepgram JWT for client-side live streaming.
 *
 * Requires `DEEPGRAM_API_KEY` with at least **Member** permissions (Console →
 * API Keys → Create → Advanced → Member). Default "usage only" keys return 403.
 */
export async function POST() {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;

  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const deepgram = createClient(apiKey);
    const { result, error } = await deepgram.auth.grantToken({
      ttl_seconds: TOKEN_TTL_SECONDS,
    });

    if (error || !result?.access_token) {
      const status =
        error instanceof DeepgramApiError ? error.status : undefined;
      const detail = error instanceof Error ? error.message : "unknown";

      if (process.env.NODE_ENV === "development") {
        console.error("[deepgram/token] grant failed:", status, detail);
      }

      if (status === 403) {
        return NextResponse.json(
          {
            error: "insufficient_permissions",
            hint: "Create a Deepgram API key with Member (or Admin) permissions.",
          },
          { status: 403 },
        );
      }

      return NextResponse.json({ error: "grant_failed" }, { status: 502 });
    }

    return NextResponse.json({
      access_token: result.access_token,
      expires_in: result.expires_in,
    });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[deepgram/token] unexpected error:", err);
    }
    return NextResponse.json({ error: "grant_failed" }, { status: 502 });
  }
}
