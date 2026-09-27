/**
 * Regression: SmartLessonLoader must not hang at 42% forever,
 * and MEDIA_INIT_TIMEOUT must not stick after successful playback.
 *
 *   npm run test:lesson-loader-gate
 */
import assert from "node:assert/strict";
import {
  DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS,
  partHasPlayableMedia,
  resolveDisplayedLoaderError,
  resolveLessonLoaderGate,
  shouldCommitMediaInitTimeout,
} from "./lessonLoaderGate";

function assertGate(
  input: Parameters<typeof resolveLessonLoaderGate>[0],
  expect: Partial<ReturnType<typeof resolveLessonLoaderGate>>,
) {
  const got = resolveLessonLoaderGate(input);
  for (const [k, v] of Object.entries(expect)) {
    assert.equal(
      (got as Record<string, unknown>)[k],
      v,
      `${k}: expected ${String(v)}, got ${String((got as Record<string, unknown>)[k])} (full=${JSON.stringify(got)})`,
    );
  }
}

// Case A — normal Section 1 with media + ready
assert.equal(
  partHasPlayableMedia({
    videoUrl: null,
    hlsManifestUrl: "coraline/1/master.m3u8",
  }),
  true,
);
assertGate(
  {
    hasPlayableMedia: true,
    bufferingProgress: 100,
    clipCanPlay: true,
    loaderRingFull: true,
    elapsedMs: 800,
  },
  {
    stage: "ready",
    shouldDismissLoader: true,
    shouldShowError: false,
    errorCode: null,
  },
);

// Case B — optional grammar empty does not affect gate (core media present)
assertGate(
  {
    hasPlayableMedia: true,
    bufferingProgress: 40,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: 500,
  },
  { stage: "buffering", shouldShowError: false, errorCode: null },
);

// Case C — optional vocabulary empty (same: media present → buffering)
assertGate(
  {
    hasPlayableMedia: true,
    bufferingProgress: 10,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: 200,
  },
  { stage: "buffering", shouldShowError: false },
);

// Case D — speech delayed: gate only cares about media/buffer, not speech
assertGate(
  {
    hasPlayableMedia: true,
    bufferingProgress: 90,
    clipCanPlay: true,
    loaderRingFull: true,
    elapsedMs: 50,
  },
  { stage: "ready", shouldDismissLoader: true },
);

// Case E — media initialization failure (missing URLs)
assert.equal(
  partHasPlayableMedia({ videoUrl: null, hlsManifestUrl: null }),
  false,
);
assertGate(
  {
    hasPlayableMedia: false,
    bufferingProgress: 0,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: 0,
  },
  {
    stage: "error",
    errorCode: "MEDIA_UNAVAILABLE",
    shouldDismissLoader: true,
    shouldShowError: true,
  },
);

assertGate(
  {
    hasPlayableMedia: true,
    mediaUnavailableSignaled: true,
    bufferingProgress: 0,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: 100,
  },
  { errorCode: "MEDIA_UNAVAILABLE", shouldShowError: true },
);

assertGate(
  {
    hasPlayableMedia: true,
    bufferingProgress: 12,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS,
  },
  {
    stage: "error",
    errorCode: "MEDIA_INIT_TIMEOUT",
    shouldShowError: true,
  },
);

// Case F — content rebuild: new UUIDs without republished media → unavailable
assertGate(
  {
    hasPlayableMedia: partHasPlayableMedia({
      videoUrl: "",
      hlsManifestUrl: "   ",
    }),
    bufferingProgress: 0,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: 42_000,
  },
  { errorCode: "MEDIA_UNAVAILABLE", shouldShowError: true },
);

// Stuck at indeterminate ceiling (42) without media must error, not ready
const stuckAt42 = resolveLessonLoaderGate({
  hasPlayableMedia: false,
  bufferingProgress: 0,
  clipCanPlay: false,
  loaderRingFull: false,
  elapsedMs: 5000,
});
assert.notEqual(stuckAt42.stage, "ready");
assert.equal(stuckAt42.shouldShowError, true);

// ── MEDIA_INIT_TIMEOUT race / sticky-error regressions ───────────────────

// Case 1 — normal success: no timeout, no error overlay
{
  const gate = resolveLessonLoaderGate({
    hasPlayableMedia: true,
    bufferingProgress: 100,
    clipCanPlay: true,
    loaderRingFull: true,
    elapsedMs: 1200,
  });
  assert.equal(gate.errorCode, null);
  assert.equal(gate.shouldShowError, false);
  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: null,
      hasPlayableMedia: true,
      clipCanPlay: true,
    }),
    null,
  );
}

// Case 2 — timeout then playing: sticky MEDIA_INIT_TIMEOUT must clear
{
  const timedOut = resolveLessonLoaderGate({
    hasPlayableMedia: true,
    bufferingProgress: 20,
    clipCanPlay: false,
    loaderRingFull: false,
    elapsedMs: DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS,
  });
  assert.equal(timedOut.errorCode, "MEDIA_INIT_TIMEOUT");

  const afterPlay = resolveLessonLoaderGate({
    hasPlayableMedia: true,
    bufferingProgress: 100,
    clipCanPlay: true,
    loaderRingFull: false,
    elapsedMs: DEFAULT_LESSON_MEDIA_INIT_TIMEOUT_MS + 5_000,
  });
  assert.equal(afterPlay.errorCode, null);
  assert.equal(afterPlay.shouldShowError, false);

  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: "MEDIA_INIT_TIMEOUT",
      hasPlayableMedia: true,
      clipCanPlay: true,
    }),
    null,
    "once playing/ready, MEDIA_INIT_TIMEOUT must not stay learner-facing",
  );

  // Playing without stutter-safe ready (HLS buffer ratio lag) must still clear
  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: "MEDIA_INIT_TIMEOUT",
      hasPlayableMedia: true,
      clipCanPlay: false,
      mediaPlaying: true,
    }),
    null,
    "actual playback clears timeout even when clipCanPlay is still false",
  );

  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: "MEDIA_INIT_TIMEOUT",
      hasPlayableMedia: true,
      clipCanPlay: false,
      bufferingProgress: 100,
    }),
    null,
    "full buffer clears timeout overlay",
  );
}

// Case 3 — stale timeout race: attempt 1 timeout ignored after attempt 2 plays
{
  assert.equal(
    shouldCommitMediaInitTimeout({
      shouldShowError: true,
      errorCode: "MEDIA_INIT_TIMEOUT",
      clipCanPlay: false,
      attemptId: 1,
      currentAttemptId: 2,
    }),
    false,
    "stale attempt timeout must be ignored",
  );
  assert.equal(
    shouldCommitMediaInitTimeout({
      shouldShowError: true,
      errorCode: "MEDIA_INIT_TIMEOUT",
      clipCanPlay: true,
      attemptId: 2,
      currentAttemptId: 2,
    }),
    false,
    "current attempt that can already play must not commit timeout",
  );
}

// Case 4 — genuine failure: timeout with no successful playback stays visible
{
  assert.equal(
    shouldCommitMediaInitTimeout({
      shouldShowError: true,
      errorCode: "MEDIA_INIT_TIMEOUT",
      clipCanPlay: false,
      attemptId: 3,
      currentAttemptId: 3,
    }),
    true,
  );
  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: "MEDIA_INIT_TIMEOUT",
      hasPlayableMedia: true,
      clipCanPlay: false,
    }),
    "MEDIA_INIT_TIMEOUT",
  );
}

// Case 5 — retry: attempt 1 timed out, attempt 2 plays → clear error
{
  const attempt1Commit = shouldCommitMediaInitTimeout({
    shouldShowError: true,
    errorCode: "MEDIA_INIT_TIMEOUT",
    clipCanPlay: false,
    attemptId: 1,
    currentAttemptId: 1,
  });
  assert.equal(attempt1Commit, true);

  // Retry bumps attempt; old commit path ignored, display cleared on play
  assert.equal(
    shouldCommitMediaInitTimeout({
      shouldShowError: true,
      errorCode: "MEDIA_INIT_TIMEOUT",
      clipCanPlay: false,
      attemptId: 1,
      currentAttemptId: 2,
    }),
    false,
  );
  assert.equal(
    resolveDisplayedLoaderError({
      loaderError: "MEDIA_INIT_TIMEOUT",
      hasPlayableMedia: true,
      clipCanPlay: true,
    }),
    null,
  );
}

// Case 6 — unmount/source change: old attempt cannot commit after bump
{
  let currentAttemptId = 1;
  currentAttemptId += 1; // source change / unmount invalidates
  assert.equal(
    shouldCommitMediaInitTimeout({
      shouldShowError: true,
      errorCode: "MEDIA_INIT_TIMEOUT",
      clipCanPlay: false,
      attemptId: 1,
      currentAttemptId,
    }),
    false,
  );
}

// MEDIA_UNAVAILABLE remains visible even if clipCanPlay is somehow true
assert.equal(
  resolveDisplayedLoaderError({
    loaderError: "MEDIA_UNAVAILABLE",
    hasPlayableMedia: false,
    clipCanPlay: false,
  }),
  "MEDIA_UNAVAILABLE",
);

console.log("lesson-loader-gate: ok");
