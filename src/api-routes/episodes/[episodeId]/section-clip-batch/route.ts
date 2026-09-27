import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";
import { getPartClipUrlsForOrders } from "@/lib/database";
import {
  countPartsForEpisode,
  getSectionClipHintsForIndices,
} from "@/lib/db/sectionProgress";
import { isContentIdParam } from "@/lib/ids/contentId";
import { NextResponse } from "next/server";

const MAX_INDICES_PER_REQUEST = 36;

/** First-clip CDN hints for unlocked sections (infinite-scroll batches). */
export async function POST(
  request: Request,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  if (!isContentIdParam(episodeId)) {
    return NextResponse.json({ error: "Invalid episode id" }, { status: 400 });
  }

  let body: { sectionIndices?: (number | string)[] };
  try {
    const parsed = (await request.json()) as unknown;
    const si =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { sectionIndices?: (number | string)[] }).sectionIndices
        : undefined;
    body = { sectionIndices: Array.isArray(si) ? si : undefined };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.sectionIndices ?? [];
  const sectionIndices = [
    ...new Set(
      raw
        .map((n: number | string) => (typeof n === "number" ? n : Number(n)))
        .filter((n: number) => Number.isFinite(n) && n >= 1),
    ),
  ].slice(0, MAX_INDICES_PER_REQUEST);

  if (sectionIndices.length === 0) {
    return NextResponse.json({ firstClipUrls: {} });
  }

  const totalParts = await countPartsForEpisode(episodeId);
  if (totalParts < 1) {
    return NextResponse.json(
      { error: "Episode has no clips" },
      { status: 404 },
    );
  }

  const user = await getCurrentUser();
  if (user && !(await userCanAccessLearning(user))) {
    return NextResponse.json(
      { error: "subscription_required" },
      { status: 403 },
    );
  }
  const { unlockBySection, firstPartOrderBySection } =
    await getSectionClipHintsForIndices({
      userId: user?.id ?? null,
      episodeId,
      totalParts,
      sectionIndices,
    });

  const orders: number[] = [];
  const orderToSection = new Map<number, number>();
  for (const sectionIndex of sectionIndices) {
    if (!unlockBySection.get(sectionIndex)) continue;
    const order = firstPartOrderBySection.get(sectionIndex);
    if (order == null || order < 1 || order > totalParts) continue;
    orders.push(order);
    orderToSection.set(order, sectionIndex);
  }

  const firstClipUrls: Record<string, string | null> = {};
  for (const s of sectionIndices) {
    firstClipUrls[String(s)] = null;
  }

  if (orders.length === 0) {
    return NextResponse.json({ firstClipUrls });
  }

  const map = await getPartClipUrlsForOrders({ episodeId, orders });
  for (const [order, secIdx] of orderToSection) {
    firstClipUrls[String(secIdx)] = map.get(order) ?? null;
  }

  return NextResponse.json({ firstClipUrls });
}
