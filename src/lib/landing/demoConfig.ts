/** Curated landing demo — Friends S01E02, clip 2. */
export const LANDING_DEMO_VIDEO_TAG = "friends";
export const LANDING_DEMO_SEASON_NUM = 1;
export const LANDING_DEMO_EPISODE_NUM = 2;
export const LANDING_DEMO_PART_ORDER = 2;

/** Bundled MP4 served from `public/landing/demo/clip.mp4`. */
export const LANDING_DEMO_PUBLIC_CLIP = "/landing/demo/clip.mp4";
export const LANDING_DEMO_PUBLIC_POSTER = "/landing/demo/poster.webp";

export const LANDING_DEMO_PART_ID =
  process.env.LANDING_DEMO_PART_ID?.trim() || null;

/** Optional override — defaults to bundled public clip. */
export const LANDING_DEMO_VIDEO_URL =
  process.env.LANDING_DEMO_VIDEO_URL?.trim() ||
  LANDING_DEMO_PUBLIC_CLIP;

export const LANDING_DEMO_HLS_URL =
  process.env.LANDING_DEMO_HLS_URL?.trim() || null;

export function resolveLandingDemoVideoUrl(): string {
  return LANDING_DEMO_VIDEO_URL;
}
