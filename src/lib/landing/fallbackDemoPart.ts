import {
  LANDING_DEMO_PART_ORDER,
  LANDING_DEMO_PUBLIC_CLIP,
  LANDING_DEMO_PUBLIC_POSTER,
  resolveLandingDemoVideoUrl,
} from "@/lib/landing/demoConfig";
import type { Part, PartSentence, PartToken } from "@/types/video";

const DEMO_PART_ID = "landing-demo-friends-s01e02-p02";
const DEMO_TEXT = "It's just that, doesn't she seem a little angry?";

/** Matches Friends S01E02 part 2 — same tokens as production DB. */
const DEMO_TOKENS: PartToken[] = [
  { id: "token-0", text: "It's", order: 1, visibleInPuzzle: true, normalized: "it's" },
  { id: "token-1", text: "just", order: 2, visibleInPuzzle: true, normalized: "just" },
  { id: "token-2", text: "that", order: 3, visibleInPuzzle: true, normalized: "that" },
  {
    id: "token-3",
    text: ",",
    order: 4,
    visibleInPuzzle: false,
    locked: true,
    type: "punctuation",
    punctuationType: "comma",
    normalized: ",",
  },
  {
    id: "token-4",
    text: "doesn't",
    order: 5,
    visibleInPuzzle: true,
    normalized: "doesnt",
  },
  { id: "token-5", text: "she", order: 6, visibleInPuzzle: true, normalized: "she" },
  { id: "token-6", text: "seem", order: 7, visibleInPuzzle: true, normalized: "seem" },
  { id: "token-7", text: "a", order: 8, visibleInPuzzle: true, normalized: "a" },
  { id: "token-8", text: "little", order: 9, visibleInPuzzle: true, normalized: "little" },
  { id: "token-9", text: "angry", order: 10, visibleInPuzzle: true, normalized: "angry" },
  {
    id: "token-10",
    text: "?",
    order: 11,
    visibleInPuzzle: false,
    locked: true,
    type: "punctuation",
    punctuationType: "question",
    normalized: "?",
  },
];

const DEMO_SENTENCES: PartSentence[] = [
  { id: "sentence-0", text: DEMO_TEXT, order: 1 },
];

/** Static fallback — bundled clip in `public/landing/demo/`. */
export function buildFallbackDemoPart(): Part {
  return {
    id: DEMO_PART_ID,
    episodeId: "landing-demo-episode",
    order: LANDING_DEMO_PART_ORDER,
    canonicalKey: null,
    speechStartMs: 0,
    speechEndMs: 4000,
    speechDurationMs: 4000,
    playbackStartMs: 0,
    playbackEndMs: 4000,
    playbackDurationMs: 4000,
    text: DEMO_TEXT,
    normalizedText: "it's just that doesn't she seem a little angry",
    sentences: DEMO_SENTENCES,
    tokens: DEMO_TOKENS,
    subtitles: null,
    wordCount: 10,
    speechRate: null,
    difficulty: "easy",
    difficultyScore: 35,
    clipGroupId: null,
    videoUrl: resolveLandingDemoVideoUrl(),
    hlsManifestUrl: null,
    thumbnailUrl: LANDING_DEMO_PUBLIC_POSTER,
    sourceClipStartMs: null,
    sourceClipEndMs: null,
    processingStatus: "ready",
    retiredAt: null,
    createdAt: new Date(0),
    translations: [
      {
        id: 0,
        partId: DEMO_PART_ID,
        language: "fa",
        text: "فقط اینکه، یکم عصبانی به نظر نمیاد؟",
        translatedSentences: null,
        provider: "landing",
        providerModel: null,
        createdAt: new Date(0),
      },
    ],
  };
}

/** Force the bundled public clip so the landing demo always plays offline. */
export function withBundledDemoVideo(part: Part): Part {
  return {
    ...part,
    videoUrl: resolveLandingDemoVideoUrl() || LANDING_DEMO_PUBLIC_CLIP,
    hlsManifestUrl: null,
    thumbnailUrl: part.thumbnailUrl ?? LANDING_DEMO_PUBLIC_POSTER,
  };
}
