import { NextResponse } from "next/server";
import { getLandingDemoContent } from "@/lib/landing/getLandingDemoContent";
import { getLandingHeroShowcase } from "@/lib/landing/getLandingHeroShowcase";

export const runtime = "nodejs";

export async function GET() {
  const [demoContent, showcaseItems] = await Promise.all([
    getLandingDemoContent(),
    getLandingHeroShowcase(),
  ]);
  return NextResponse.json({ demoContent, showcaseItems });
}
