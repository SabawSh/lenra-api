import englishNormalizationVariants from "@/helper/speech/data/englishNormalizationVariants.json";
import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

type VariantDataset = {
  readonly variants: Readonly<Record<string, readonly string[]>>;
};

const dataset = englishNormalizationVariants as VariantDataset;

let cachedIndex: ReadonlyMap<string, readonly string[]> | null = null;

/**
 * Bidirectional orthographic / colloquial variant index derived from Kaldi
 * english.glm. Loaded once from the vendored JSON (no network).
 */
export function getEnglishNormalizationVariantIndex(): ReadonlyMap<
  string,
  readonly string[]
> {
  if (cachedIndex) return cachedIndex;

  const index = new Map<string, readonly string[]>();
  for (const [rawKey, rawForms] of Object.entries(dataset.variants)) {
    const key = normalizeSpeechToken(rawKey);
    if (!key) continue;

    const forms = new Set<string>();
    for (const form of rawForms) {
      const normalized = normalizeSpeechToken(form);
      if (normalized) forms.add(normalized);
    }

    // Also keep lightly spaced dataset keys that normalize identically,
    // and merge any class members already indexed under this runtime key.
    const existing = index.get(key);
    if (existing) {
      for (const form of existing) forms.add(form);
    }

    if (forms.size > 0) {
      index.set(key, [...forms].sort((left, right) => left.localeCompare(right)));
    }
  }

  cachedIndex = index;
  return cachedIndex;
}

/** Test-only: clear the singleton index cache. */
export function clearEnglishNormalizationVariantIndexForTests(): void {
  cachedIndex = null;
}

/**
 * Supplies orthographic / colloquial alternate forms from the english.glm
 * normalization dataset. Same closed-vocabulary contract as other providers.
 */
export function createVariantFormProvider(): ExpectedTokenFormProvider {
  const index = getEnglishNormalizationVariantIndex();

  return {
    id: "variant-forms",
    formsForToken(
      token: string,
      context: ExpectedTokenFormProviderContext,
    ): readonly string[] {
      const key = normalizeSpeechToken(token);
      if (!key || !context.closedVocabulary.has(key)) return [];

      const forms = index.get(key);
      if (!forms || forms.length === 0) return [];

      // Orthographic provider already emits the canonical key; return the
      // full equivalence class (merge layer dedupes).
      return forms;
    },
  };
}
