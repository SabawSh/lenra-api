/**
 * Lesson SmartLessonLoader gate — pure state machine used by the Learn player.
 *
 * The Suspense fallback crawls 0→42% (indeterminate). After hydrate, the real
 * overlay waits for buffering / canplay. Missing media or a stuck init must
 * transition to an explicit error instead of hanging forever at 42%.
 *
 * MEDIA_INIT_TIMEOUT is only a candidate failure: once the clip becomes
 * playable (`clipCanPlay`), the timeout must not remain learner-facing.
 */

export type LessonLoaderErrorCode =
  | "MEDIA_UNAVAILABLE"
  | "MEDIA_INIT_TIMEOUT";

export type LessonLoaderStage =
  | "start"
  | "awaiting-media"
  | "buffering"
  | "ready"
  | "error";

export type LessonLoaderGateInput = {
  /** Current clip has a non-empty HLS or MP4 URL. */
  hasPlayableMedia: boolean;
  /** Player signaled empty resolvePlaybackSources. */
  mediaUnavailableSignaled?: boolean;
  bufferingProgress: number;
  clipCanPlay: boolean;
  loaderRingFull: boolean;
  /** Wall time since this clip's loader became active. */
  elapsedMs: number;
  /** Max wait before MEDIA_INIT_TIMEOUT (default 25s). */
  timeoutMs?: number;
};

export type LessonLoaderGateResult = {
  stage: LessonLoaderStage;
  errorCode: LessonLoaderErrorCode | null;
  /** Dismiss the overlay and show the player (or error surface). */
  shouldDismissLoader: boolean;
  /** Replace the progress ring with an error UI. */
  shouldShowError: boolean;
};

export const DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS = 25_000;

export function partHasPlayableMedia(part: {
  videoUrl?: string | null;
  hlsManifestUrl?: string | null;
}): boolean {
  return Boolean(
    (part.hlsManifestUrl && part.hlsManifestUrl.trim()) ||
      (part.videoUrl && part.videoUrl.trim()),
  );
}

export function resolveLessonLoaderGate(
  input: LessonLoaderGateInput,
): LessonLoaderGateResult {
  const timeoutMs = input.timeoutMs ?? DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS;

  if (!input.hasPlayableMedia || input.mediaUnavailableSignaled) {
    return {
      stage: "error",
      errorCode: "MEDIA_UNAVAILABLE",
      shouldDismissLoader: true,
      shouldShowError: true,
    };
  }

  // Successful media init always wins over a prior timeout candidate.
  if (input.clipCanPlay && input.loaderRingFull) {
    return {
      stage: "ready",
      errorCode: null,
      shouldDismissLoader: true,
      shouldShowError: false,
    };
  }

  if (input.clipCanPlay) {
    return {
      stage: "buffering",
      errorCode: null,
      shouldDismissLoader: false,
      shouldShowError: false,
    };
  }

  if (input.elapsedMs >= timeoutMs) {
    return {
      stage: "error",
      errorCode: "MEDIA_INIT_TIMEOUT",
      shouldDismissLoader: true,
      shouldShowError: true,
    };
  }

  if (input.bufferingProgress <= 0) {
    return {
      stage: "awaiting-media",
      errorCode: null,
      shouldDismissLoader: false,
      shouldShowError: false,
    };
  }

  return {
    stage: "buffering",
    errorCode: null,
    shouldDismissLoader: false,
    shouldShowError: false,
  };
}

/**
 * Apply a gate-reported init timeout only if the attempt is still current
 * and the media has not become playable.
 */
export function shouldCommitMediaInitTimeout(input: {
  shouldShowError: boolean;
  errorCode: LessonLoaderErrorCode | null;
  clipCanPlay: boolean;
  attemptId: number;
  currentAttemptId: number;
}): boolean {
  if (input.attemptId !== input.currentAttemptId) return false;
  if (input.clipCanPlay) return false;
  return input.shouldShowError && input.errorCode === "MEDIA_INIT_TIMEOUT";
}

/**
 * Learner-facing error surface — never keep MEDIA_INIT_TIMEOUT once media
 * is playable or has actually started playback.
 */
export function resolveDisplayedLoaderError(input: {
  loaderError: LessonLoaderErrorCode | null;
  hasPlayableMedia: boolean;
  clipCanPlay: boolean;
  /** True when the media element has entered playback. */
  mediaPlaying?: boolean;
  /** 0–100 buffering progress — high values imply media has loaded. */
  bufferingProgress?: number;
}): LessonLoaderErrorCode | null {
  const mediaStarted =
    input.clipCanPlay ||
    input.mediaPlaying === true ||
    (input.bufferingProgress ?? 0) >= 100;

  if (mediaStarted && input.loaderError === "MEDIA_INIT_TIMEOUT") {
    return null;
  }
  if (input.loaderError) return input.loaderError;
  if (!input.hasPlayableMedia) return "MEDIA_UNAVAILABLE";
  return null;
}

/** Dev-only console line — never log secrets. */
export function formatLearnLoadingDiag(opts: {
  stage: LessonLoaderStage;
  progress: number;
  status: string;
  errorCode?: LessonLoaderErrorCode | null;
}): string {
  const err = opts.errorCode ? ` error=${opts.errorCode}` : "";
  return `[LearnLoading] stage=${opts.stage} progress=${Math.round(opts.progress)} status=${opts.status}${err}`;
}
