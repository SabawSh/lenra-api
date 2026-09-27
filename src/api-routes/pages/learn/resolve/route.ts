import { NextResponse } from "next/server";
import {
  resolveLearnPage,
  type LearnPageResolveInput,
} from "@/services/pages/learnPageResolve";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: LearnPageResolveInput;
  try {
    body = (await req.json()) as LearnPageResolveInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    typeof body.locale !== "string" ||
    typeof body.type !== "string" ||
    typeof body.videoId !== "string" ||
    !Array.isArray(body.rawParams) ||
    !body.searchParams ||
    typeof body.searchParams !== "object"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await resolveLearnPage(body);
  return NextResponse.json(result);
}
