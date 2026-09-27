/**
 * Speech pipeline component versions for replay fixture provenance.
 *
 * These are metadata only — replay execution ignores them.
 * Bump a component's version when its *observable algorithmic behavior*
 * changes in a way that could change placement outcomes for the same events.
 */
export const SPEECH_PIPELINE_VERSION = "v1";

/** Caption / puzzle tile construction surface (how tiles are chunked). */
export const SPEECH_CAPTION_VERSION = "v1";

/** Adaptive teacher / knowledge refresh path that can affect matching. */
export const SPEECH_ADAPTIVE_TEACHER_VERSION = "v1";

/** Token match lexicon / pronunciation surface build. */
export const SPEECH_LEXICON_VERSION = "v1";

/** normalizeText / normalizeSpeechToken behavior. */
export const SPEECH_NORMALIZER_VERSION = "v1";

/** matchVoiceTiles / gates / decision engine. */
export const SPEECH_MATCHER_VERSION = "v1";

/** appendPlacements / session placement owner. */
export const SPEECH_PLACEMENT_VERSION = "v1";

export type SpeechPipelineVersionSnapshot = {
  pipelineVersion: string;
  gitCommit: string | null;
  appVersion: string;
  captionVersion: string;
  adaptiveTeacherVersion: string;
  lexiconVersion: string;
  normalizerVersion: string;
  matcherVersion: string;
  placementVersion: string;
  exportedAt: string;
};

function readGitCommit(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_GIT_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA,
    process.env.GIT_COMMIT,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readAppVersion(fallback?: string): string {
  return (
    fallback?.trim() ||
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    process.env.npm_package_version?.trim() ||
    "0.1.0"
  );
}

/**
 * Snapshot of versions at export time.
 * Safe to call from browser (uses NEXT_PUBLIC_* / build-injected env).
 */
export function getSpeechPipelineVersionSnapshot(
  appVersionOverride?: string,
): SpeechPipelineVersionSnapshot {
  return {
    pipelineVersion: SPEECH_PIPELINE_VERSION,
    gitCommit: readGitCommit(),
    appVersion: readAppVersion(appVersionOverride),
    captionVersion: SPEECH_CAPTION_VERSION,
    adaptiveTeacherVersion: SPEECH_ADAPTIVE_TEACHER_VERSION,
    lexiconVersion: SPEECH_LEXICON_VERSION,
    normalizerVersion: SPEECH_NORMALIZER_VERSION,
    matcherVersion: SPEECH_MATCHER_VERSION,
    placementVersion: SPEECH_PLACEMENT_VERSION,
    exportedAt: new Date().toISOString(),
  };
}
