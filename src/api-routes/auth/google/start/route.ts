import {
  buildGoogleAuthUrl,
  createSignedOAuthState,
  getGoogleRedirectUri,
  sanitizeOAuthNext,
  type GoogleOAuthIntent,
} from "@/lib/auth/google";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VALID_INTENTS: GoogleOAuthIntent[] = [
  "link_phone",
  "link_google_settings",
];

/**
 * GET /api/auth/google/start?next=/dashboard&intent=link_phone
 * Redirects to Google with a signed `state` (CSRF + next/intent; no cookies required on callback).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = sanitizeOAuthNext(url.searchParams.get("next"));
  const intentParam = url.searchParams.get("intent");

  const intent =
    intentParam &&
    VALID_INTENTS.includes(intentParam as GoogleOAuthIntent)
      ? (intentParam as GoogleOAuthIntent)
      : undefined;

  const redirectUri = getGoogleRedirectUri(req);
  const state = createSignedOAuthState({ next, intent, redirectUri });
  return NextResponse.redirect(buildGoogleAuthUrl(state, req, redirectUri));
}
