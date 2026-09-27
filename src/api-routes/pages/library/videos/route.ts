import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildLibraryVideosPage } from "@/services/pages/libraryVideos";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  const data = await buildLibraryVideosPage(user?.id ?? null);
  return NextResponse.json(data);
}
