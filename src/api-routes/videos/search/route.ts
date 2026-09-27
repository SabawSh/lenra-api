import { NextResponse } from "next/server";
import * as vq from "@/lib/db/queries/videos";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(20, Math.max(1, Number(limitRaw) || 6)) : 6;

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const data = await vq.searchVideosByNamePrefix(q, limit);
  const results = data.map((v) => ({
    id: v.id,
    name: v.name,
    type: v.type,
    coverUrl: v.coverUrl ?? null,
  }));
  return NextResponse.json({ results });
}
