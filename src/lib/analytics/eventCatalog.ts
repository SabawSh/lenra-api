export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "session_start",
  "session_end",
  "cta_click",
  "signup_started",
  "signup_completed",
  "login",
  "logout",
  "movie_view",
  "clip_view",
  "lesson_start",
  "video_play",
  "video_pause",
  "video_complete",
  "exercise_start",
  "exercise_attempt",
  "exercise_completed",
  "vocabulary_view",
  "grammar_view",
  "speaking_attempt",
  "lesson_complete",
  "pricing_view",
  "checkout_started",
  "subscription_started",
  "subscription_cancelled",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const EVENT_CATEGORY_BY_NAME: Record<
  AnalyticsEventName,
  "website" | "learning" | "conversion" | "system"
> = {
  page_view: "website",
  session_start: "website",
  session_end: "website",
  cta_click: "website",
  signup_started: "website",
  signup_completed: "website",
  login: "website",
  logout: "website",
  movie_view: "learning",
  clip_view: "learning",
  lesson_start: "learning",
  video_play: "learning",
  video_pause: "learning",
  video_complete: "learning",
  exercise_start: "learning",
  exercise_attempt: "learning",
  exercise_completed: "learning",
  vocabulary_view: "learning",
  grammar_view: "learning",
  speaking_attempt: "learning",
  lesson_complete: "learning",
  pricing_view: "conversion",
  checkout_started: "conversion",
  subscription_started: "conversion",
  subscription_cancelled: "conversion",
};

export const ANALYTICS_MAX_BATCH = 40;
export const ANALYTICS_MAX_PROPERTY_BYTES = 4_000;
export const ANALYTICS_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);
