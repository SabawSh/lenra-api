export type SttFallbackConfig = {
  /** Master switch — when false, retry orchestration is a no-op. */
  fallbackEnabled: boolean;
  /** Retry Web Speech when confidence is below this value (0..1). */
  retryConfidence: number;
  /** Log STT fallback diagnostics to the console. */
  debug: boolean;
};

const DEFAULT_RETRY_CONFIDENCE = 0.7;

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

function parseConfidenceEnv(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_RETRY_CONFIDENCE;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RETRY_CONFIDENCE;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Client-readable STT fallback flags (`NEXT_PUBLIC_*`).
 * Defaults keep current production behavior unchanged.
 */
export function resolveSttFallbackConfig(
  overrides?: Partial<SttFallbackConfig>,
): SttFallbackConfig {
  const fromEnv: SttFallbackConfig = {
    fallbackEnabled: parseBooleanEnv(
      process.env.NEXT_PUBLIC_STT_FALLBACK_ENABLED,
      false,
    ),
    retryConfidence: parseConfidenceEnv(
      process.env.NEXT_PUBLIC_STT_RETRY_CONFIDENCE,
    ),
    debug: parseBooleanEnv(process.env.NEXT_PUBLIC_STT_DEBUG, false),
  };

  return {
    ...fromEnv,
    ...overrides,
  };
}
