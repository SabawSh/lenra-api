export type LandingScreenshotId =
  | "movie-player"
  | "sentence-builder"
  | "voice-speaking"
  | "vocabulary"
  | "review"
  | "progress-dashboard"
  | "section-completion";

/**
 * Real product screenshots — add WebP/PNG files under `public/landing/` when captured.
 * Each entry documents exactly which in-app screen to capture.
 */
export const LANDING_SCREENSHOTS: Record<
  LandingScreenshotId,
  { assetPath: string; captureNote: string }
> = {
  "movie-player": {
    assetPath: "/landing/movie-player.webp",
    captureNote:
      "Movie learning player — learn route with video, subtitles, and lesson controls",
  },
  "sentence-builder": {
    assetPath: "/landing/sentence-builder.webp",
    captureNote:
      "Sentence builder puzzle — drag-and-drop word chips to reconstruct a line",
  },
  "voice-speaking": {
    assetPath: "/landing/voice-speaking.webp",
    captureNote:
      "Voice speaking mode — hold-to-speak mic UI with phrase and waveform",
  },
  vocabulary: {
    assetPath: "/landing/vocabulary.webp",
    captureNote:
      "Vocabulary screen — saved words with movie context on dashboard/vocabulary",
  },
  review: {
    assetPath: "/landing/review.webp",
    captureNote: "Review system — spaced repetition review session UI",
  },
  "progress-dashboard": {
    assetPath: "/landing/progress-dashboard.webp",
    captureNote:
      "Progress/dashboard screen — XP, streaks, and learning stats overview",
  },
  "section-completion": {
    assetPath: "/landing/section-completion.webp",
    captureNote:
      "Section completion screen — summary after finishing a movie section",
  },
};

export const LANDING_SCREENSHOT_ORDER: LandingScreenshotId[] = [
  "movie-player",
  "sentence-builder",
  "voice-speaking",
  "vocabulary",
  "review",
  "progress-dashboard",
  "section-completion",
];
