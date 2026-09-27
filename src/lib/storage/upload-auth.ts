import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

/**
 * Presigned uploads are restricted to site media admins (fixed email + phone),
 * unless the caller passes a valid `CLOUD_UPLOAD_API_KEY` Bearer token (CLI / tooling).
 */
export async function assertMediaUploadAllowed(
  req: Request
): Promise<NextResponse | null> {
  const apiKey = process.env.CLOUD_UPLOAD_API_KEY?.trim();
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (apiKey && bearer === apiKey) {
    return null;
  }

  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
