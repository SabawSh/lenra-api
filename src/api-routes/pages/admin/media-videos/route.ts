import { NextResponse } from "next/server";
import { getVideos } from "@/lib/db/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;
  const videos = await getVideos();
  return NextResponse.json({ videos });
}
