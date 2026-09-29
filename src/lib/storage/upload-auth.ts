import { NextResponse } from "next/server";

import { getApiRequest } from "@/lib/auth/apiRequestContext";
import {
  getCurrentUser,
  getCurrentUserUncached,
} from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { normalizeEnvValue } from "@/config/env.js";

/**
 * Presigned uploads are restricted to site media admins (fixed email + phone),
 * unless the caller passes a valid `CLOUD_UPLOAD_API_KEY` Bearer token (CLI / tooling).
 */
export async function assertMediaUploadAllowed(
  req: Request
): Promise<NextResponse | null> {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  const uploadKey = process.env.CLOUD_UPLOAD_API_KEY
    ? normalizeEnvValue(process.env.CLOUD_UPLOAD_API_KEY)
    : "";
  const internalSecret = process.env.API_INTERNAL_SECRET
    ? normalizeEnvValue(process.env.API_INTERNAL_SECRET)
    : "";
  if (
    bearer &&
    ((uploadKey && bearer === uploadKey) ||
      (internalSecret && bearer === internalSecret))
  ) {
    return null;
  }

  try {
    const user = getApiRequest()
      ? await getCurrentUserUncached()
      : await getCurrentUser();
    if (!user || !isSiteMediaAdmin(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[upload-auth]", message);
    return NextResponse.json(
      { error: "Auth check failed", detail: message },
      { status: 503 },
    );
  }
}
