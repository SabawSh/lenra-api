import type { VideoType } from "@/types/schema";

/** Deck slot layout — index 0 is the front (active) card */
export const HERO_DECK_SLOTS = [
  { x: 0, y: 0, rotate: 0, scale: 1, zIndex: 40, opacity: 1 },
  { x: 88, y: 18, rotate: 9, scale: 0.91, zIndex: 30, opacity: 1 },
  { x: -88, y: 26, rotate: -9, scale: 0.84, zIndex: 20, opacity: 0.96 },
  { x: 0, y: 34, rotate: 0, scale: 0.78, zIndex: 10, opacity: 0.9 },
] as const;

/** Soft sparkles around the video aura */
export const HERO_AURA_SPARKLES = [
  { top: "48%", left: "16%", size: 3, opacity: 0.55 },
  { top: "62%", left: "28%", size: 2, opacity: 0.4 },
  { top: "70%", left: "44%", size: 3, opacity: 0.5 },
  { top: "68%", left: "58%", size: 2, opacity: 0.45 },
  { top: "60%", left: "74%", size: 3, opacity: 0.5 },
  { top: "50%", left: "84%", size: 2, opacity: 0.4 },
] as const;

type HeroShowcaseVideo = {
  type: VideoType;
  seasons?: readonly unknown[] | null;
};

function isStandaloneVideoType(type: VideoType): boolean {
  return type === "movie" || type === "documentary";
}

/** Standalone titles belong in the hero once catalogued; series need seasons or parts. */
export function isLandingHeroShowcaseEligible(
  video: HeroShowcaseVideo,
  partsCount: number,
): boolean {
  const seasonCount = video.seasons?.length ?? 0;
  return (
    seasonCount > 0 ||
    partsCount > 0 ||
    isStandaloneVideoType(video.type)
  );
}
