/** Auto-generated — do not edit. Run: npm run generate:routes */

export type LenraRouteHandler = (req: Request, ctx?: unknown) => Response | Promise<Response>;

export type LenraRouteEntry = {
  urlPattern: string;
  paramNames: string[];
  load: () => Promise<Record<string, unknown>>;
};

export const lenraRoutes: LenraRouteEntry[] = [
  {
    urlPattern: "/api/admin/adaptive-teacher",
    paramNames: [],
    load: () => import("../../api-routes/admin/adaptive-teacher/route.js"),
  },
  {
    urlPattern: "/api/admin/content-import",
    paramNames: [],
    load: () => import("../../api-routes/admin/content-import/route.js"),
  },
  {
    urlPattern: "/api/admin/content-import/episode",
    paramNames: [],
    load: () => import("../../api-routes/admin/content-import/episode/route.js"),
  },
  {
    urlPattern: "/api/admin/cover-catalog",
    paramNames: [],
    load: () => import("../../api-routes/admin/cover-catalog/route.js"),
  },
  {
    urlPattern: "/api/admin/learning-bug-reports",
    paramNames: [],
    load: () => import("../../api-routes/admin/learning-bug-reports/route.js"),
  },
  {
    urlPattern: "/api/admin/seed-catalog",
    paramNames: [],
    load: () => import("../../api-routes/admin/seed-catalog/route.js"),
  },
  {
    urlPattern: "/api/admin/speech-replay",
    paramNames: [],
    load: () => import("../../api-routes/admin/speech-replay/route.js"),
  },
  {
    urlPattern: "/api/admin/update-cover",
    paramNames: [],
    load: () => import("../../api-routes/admin/update-cover/route.js"),
  },
  {
    urlPattern: "/api/admin/update-video-meta",
    paramNames: [],
    load: () => import("../../api-routes/admin/update-video-meta/route.js"),
  },
  {
    urlPattern: "/api/admin/upload-cover",
    paramNames: [],
    load: () => import("../../api-routes/admin/upload-cover/route.js"),
  },
  {
    urlPattern: "/api/admin/user-plans",
    paramNames: [],
    load: () => import("../../api-routes/admin/user-plans/route.js"),
  },
  {
    urlPattern: "/api/attempts",
    paramNames: [],
    load: () => import("../../api-routes/attempts/route.js"),
  },
  {
    urlPattern: "/api/auth/google/callback",
    paramNames: [],
    load: () => import("../../api-routes/auth/google/callback/route.js"),
  },
  {
    urlPattern: "/api/auth/google/start",
    paramNames: [],
    load: () => import("../../api-routes/auth/google/start/route.js"),
  },
  {
    urlPattern: "/api/auth/me",
    paramNames: [],
    load: () => import("../../api-routes/auth/me/route.js"),
  },
  {
    urlPattern: "/api/auth/methods",
    paramNames: [],
    load: () => import("../../api-routes/auth/methods/route.js"),
  },
  {
    urlPattern: "/api/auth/methods/:provider",
    paramNames: ["provider"],
    load: () => import("../../api-routes/auth/methods/[provider]/route.js"),
  },
  {
    urlPattern: "/api/auth/phone/signup",
    paramNames: [],
    load: () => import("../../api-routes/auth/phone/signup/route.js"),
  },
  {
    urlPattern: "/api/auth/phone/start",
    paramNames: [],
    load: () => import("../../api-routes/auth/phone/start/route.js"),
  },
  {
    urlPattern: "/api/auth/phone/verify",
    paramNames: [],
    load: () => import("../../api-routes/auth/phone/verify/route.js"),
  },
  {
    urlPattern: "/api/auth/sign-out",
    paramNames: [],
    load: () => import("../../api-routes/auth/sign-out/route.js"),
  },
  {
    urlPattern: "/api/cron/push-reminders",
    paramNames: [],
    load: () => import("../../api-routes/cron/push-reminders/route.js"),
  },
  {
    urlPattern: "/api/dictionary",
    paramNames: [],
    load: () => import("../../api-routes/dictionary/route.js"),
  },
  {
    urlPattern: "/api/episodes/:episodeId/batch-preview",
    paramNames: ["episodeId"],
    load: () => import("../../api-routes/episodes/[episodeId]/batch-preview/route.js"),
  },
  {
    urlPattern: "/api/episodes/:episodeId/last-position",
    paramNames: ["episodeId"],
    load: () => import("../../api-routes/episodes/[episodeId]/last-position/route.js"),
  },
  {
    urlPattern: "/api/episodes/:episodeId/learning-sidebar",
    paramNames: ["episodeId"],
    load: () => import("../../api-routes/episodes/[episodeId]/learning-sidebar/route.js"),
  },
  {
    urlPattern: "/api/episodes/:episodeId/section-clip-batch",
    paramNames: ["episodeId"],
    load: () => import("../../api-routes/episodes/[episodeId]/section-clip-batch/route.js"),
  },
  {
    urlPattern: "/api/episodes/:episodeId/sections-state",
    paramNames: ["episodeId"],
    load: () => import("../../api-routes/episodes/[episodeId]/sections-state/route.js"),
  },
  {
    urlPattern: "/api/gamification/progression",
    paramNames: [],
    load: () => import("../../api-routes/gamification/progression/route.js"),
  },
  {
    urlPattern: "/api/gamification/xp",
    paramNames: [],
    load: () => import("../../api-routes/gamification/xp/route.js"),
  },
  {
    urlPattern: "/api/last-seen/season",
    paramNames: [],
    load: () => import("../../api-routes/last-seen/season/route.js"),
  },
  {
    urlPattern: "/api/learning/advance-resume",
    paramNames: [],
    load: () => import("../../api-routes/learning/advance-resume/route.js"),
  },
  {
    urlPattern: "/api/learning/session-stats",
    paramNames: [],
    load: () => import("../../api-routes/learning/session-stats/route.js"),
  },
  {
    urlPattern: "/api/learning/bug-report",
    paramNames: [],
    load: () => import("../../api-routes/learning/bug-report/route.js"),
  },
  {
    urlPattern: "/api/learning/grammar",
    paramNames: [],
    load: () => import("../../api-routes/learning/grammar/route.js"),
  },
  {
    urlPattern: "/api/learning/save-card",
    paramNames: [],
    load: () => import("../../api-routes/learning/save-card/route.js"),
  },
  {
    urlPattern: "/api/legal/accept",
    paramNames: [],
    load: () => import("../../api-routes/legal/accept/route.js"),
  },
  {
    urlPattern: "/api/media/catalog",
    paramNames: [],
    load: () => import("../../api-routes/media/catalog/route.js"),
  },
  {
    urlPattern: "/api/media/commit",
    paramNames: [],
    load: () => import("../../api-routes/media/commit/route.js"),
  },
  {
    urlPattern: "/api/media/hls/cleanup-legacy",
    paramNames: [],
    load: () => import("../../api-routes/media/hls/cleanup-legacy/route.js"),
  },
  {
    urlPattern: "/api/media/hls/generate",
    paramNames: [],
    load: () => import("../../api-routes/media/hls/generate/route.js"),
  },
  {
    urlPattern: "/api/media/presign",
    paramNames: [],
    load: () => import("../../api-routes/media/presign/route.js"),
  },
  {
    urlPattern: "/api/media/put",
    paramNames: [],
    load: () => import("../../api-routes/media/put/route.js"),
  },
  {
    urlPattern: "/api/movies/:videoId/batch-preview",
    paramNames: ["videoId"],
    load: () => import("../../api-routes/movies/[videoId]/batch-preview/route.js"),
  },
  {
    urlPattern: "/api/movies/:videoId/learning-sidebar",
    paramNames: ["videoId"],
    load: () => import("../../api-routes/movies/[videoId]/learning-sidebar/route.js"),
  },
  {
    urlPattern: "/api/movies/:videoId/sections-state",
    paramNames: ["videoId"],
    load: () => import("../../api-routes/movies/[videoId]/sections-state/route.js"),
  },
  {
    urlPattern: "/api/onboarding",
    paramNames: [],
    load: () => import("../../api-routes/onboarding/route.js"),
  },
  {
    urlPattern: "/api/onboarding/check-username",
    paramNames: [],
    load: () => import("../../api-routes/onboarding/check-username/route.js"),
  },
  {
    urlPattern: "/api/pages/admin/adaptive-teacher-users",
    paramNames: [],
    load: () => import("../../api-routes/pages/admin/adaptive-teacher-users/route.js"),
  },
  {
    urlPattern: "/api/pages/admin/overview",
    paramNames: [],
    load: () => import("../../api-routes/pages/admin/overview/route.js"),
  },
  {
    urlPattern: "/api/pages/admin/reported-bugs",
    paramNames: [],
    load: () => import("../../api-routes/pages/admin/reported-bugs/route.js"),
  },
  {
    urlPattern: "/api/pages/admin/users",
    paramNames: [],
    load: () => import("../../api-routes/pages/admin/users/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/achievements",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/achievements/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/achievements-page",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/achievements-page/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/main",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/main/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/progress",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/progress/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/reminders",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/reminders/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/settings",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/settings/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/visit",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/visit/route.js"),
  },
  {
    urlPattern: "/api/pages/dashboard/vocabulary",
    paramNames: [],
    load: () => import("../../api-routes/pages/dashboard/vocabulary/route.js"),
  },
  {
    urlPattern: "/api/pages/home/sidebar-stats",
    paramNames: [],
    load: () => import("../../api-routes/pages/home/sidebar-stats/route.js"),
  },
  {
    urlPattern: "/api/pages/landing",
    paramNames: [],
    load: () => import("../../api-routes/pages/landing/route.js"),
  },
  {
    urlPattern: "/api/pages/learn/resolve",
    paramNames: [],
    load: () => import("../../api-routes/pages/learn/resolve/route.js"),
  },
  {
    urlPattern: "/api/pages/admin/media-videos",
    paramNames: [],
    load: () => import("../../api-routes/pages/admin/media-videos/route.js"),
  },
  {
    urlPattern: "/api/pages/library/favorites",
    paramNames: [],
    load: () => import("../../api-routes/pages/library/favorites/route.js"),
  },
  {
    urlPattern: "/api/pages/library/videos",
    paramNames: [],
    load: () => import("../../api-routes/pages/library/videos/route.js"),
  },
  {
    urlPattern: "/api/pages/movies/:id/entry",
    paramNames: ["id"],
    load: () => import("../../api-routes/pages/movies/[id]/entry/route.js"),
  },
  {
    urlPattern: "/api/pages/movies/:id/sections",
    paramNames: ["id"],
    load: () => import("../../api-routes/pages/movies/[id]/sections/route.js"),
  },
  {
    urlPattern: "/api/pages/series/:id",
    paramNames: ["id"],
    load: () => import("../../api-routes/pages/series/[id]/route.js"),
  },
  {
    urlPattern: "/api/pages/series/:id/:seasonId",
    paramNames: ["id","seasonId"],
    load: () => import("../../api-routes/pages/series/[id]/[seasonId]/route.js"),
  },
  {
    urlPattern: "/api/pages/series/:id/:seasonId/:episodeId/entry",
    paramNames: ["id","seasonId","episodeId"],
    load: () => import("../../api-routes/pages/series/[id]/[seasonId]/[episodeId]/entry/route.js"),
  },
  {
    urlPattern: "/api/pages/series/:id/:seasonId/:episodeId/sections",
    paramNames: ["id","seasonId","episodeId"],
    load: () => import("../../api-routes/pages/series/[id]/[seasonId]/[episodeId]/sections/route.js"),
  },
  {
    urlPattern: "/api/payments/bitpay/callback",
    paramNames: [],
    load: () => import("../../api-routes/payments/bitpay/callback/route.js"),
  },
  {
    urlPattern: "/api/payments/bitpay/checkout",
    paramNames: [],
    load: () => import("../../api-routes/payments/bitpay/checkout/route.js"),
  },
  {
    urlPattern: "/api/payments/bitpay/start",
    paramNames: [],
    load: () => import("../../api-routes/payments/bitpay/start/route.js"),
  },
  {
    urlPattern: "/api/payments/bitpay/verify",
    paramNames: [],
    load: () => import("../../api-routes/payments/bitpay/verify/route.js"),
  },
  {
    urlPattern: "/api/performance",
    paramNames: [],
    load: () => import("../../api-routes/performance/route.js"),
  },
  {
    urlPattern: "/api/push/settings",
    paramNames: [],
    load: () => import("../../api-routes/push/settings/route.js"),
  },
  {
    urlPattern: "/api/push/subscribe",
    paramNames: [],
    load: () => import("../../api-routes/push/subscribe/route.js"),
  },
  {
    urlPattern: "/api/push/unsubscribe",
    paramNames: [],
    load: () => import("../../api-routes/push/unsubscribe/route.js"),
  },
  {
    urlPattern: "/api/reminders",
    paramNames: [],
    load: () => import("../../api-routes/reminders/route.js"),
  },
  {
    urlPattern: "/api/speech/deepgram/token",
    paramNames: [],
    load: () => import("../../api-routes/speech/deepgram/token/route.js"),
  },
  {
    urlPattern: "/api/speech/deepgram/transcribe",
    paramNames: [],
    load: () => import("../../api-routes/speech/deepgram/transcribe/route.js"),
  },
  {
    urlPattern: "/api/user-vocabulary",
    paramNames: [],
    load: () => import("../../api-routes/user-vocabulary/route.js"),
  },
  {
    urlPattern: "/api/user/avatar",
    paramNames: [],
    load: () => import("../../api-routes/user/avatar/route.js"),
  },
  {
    urlPattern: "/api/user/bookmark",
    paramNames: [],
    load: () => import("../../api-routes/user/bookmark/route.js"),
  },
  {
    urlPattern: "/api/user/settings",
    paramNames: [],
    load: () => import("../../api-routes/user/settings/route.js"),
  },
  {
    urlPattern: "/api/videos/:videoId/like",
    paramNames: ["videoId"],
    load: () => import("../../api-routes/videos/[videoId]/like/route.js"),
  },
  {
    urlPattern: "/api/videos/search",
    paramNames: [],
    load: () => import("../../api-routes/videos/search/route.js"),
  },
  {
    urlPattern: "/api/vocabulary",
    paramNames: [],
    load: () => import("../../api-routes/vocabulary/route.js"),
  },
  {
    urlPattern: "/api/vocabulary/:id",
    paramNames: ["id"],
    load: () => import("../../api-routes/vocabulary/[id]/route.js"),
  },
];
