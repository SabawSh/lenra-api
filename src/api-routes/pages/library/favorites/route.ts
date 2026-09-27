import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildFavoritesPage } from "@/services/pages/libraryFavorites";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  const data = await buildFavoritesPage(user?.id ?? null);
  return NextResponse.json(JSON.parse(JSON.stringify(data)));
}
