import {
  arpabetAlignedSurface,
  arpabetSurfaceAlternates,
} from "@/helper/speech/arpabetToSurface";
import {
  loadCmuDict,
  lookupCmuArpabet,
  type CmuDict,
} from "@/helper/speech/cmuDictLookup";
import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

function normalizeLexiconKey(token: string): string {
  return normalizeSpeechToken(token);
}

/**
 * CMUdict pronunciation surfaces only — excludes orthographic canonical form.
 */
export function buildCmuDictSurfacesOnly(
  token: string,
  dict: CmuDict,
): readonly string[] {
  const orthographic = normalizeLexiconKey(token);
  if (!orthographic) return [];

  const forms = new Set<string>();
  const phones = lookupCmuArpabet(dict, orthographic);

  if (phones) {
    const aligned = arpabetAlignedSurface(orthographic, phones);
    if (aligned && aligned !== orthographic) {
      forms.add(aligned);
    }
    for (const alternate of arpabetSurfaceAlternates(orthographic, phones)) {
      if (alternate !== orthographic) {
        forms.add(alternate);
      }
    }
  }

  return [...forms];
}

/**
 * Build lexical match forms for a single tile token using CMUdict pronunciation.
 * Orthographic form is always included; dictionary-derived surfaces are additive.
 */
export function buildCmuDictTokenForms(
  token: string,
  dict: CmuDict,
): readonly string[] {
  const orthographic = normalizeLexiconKey(token);
  if (!orthographic) return [];

  return [orthographic, ...buildCmuDictSurfacesOnly(token, dict)];
}

export function createCmuDictProvider(dict: CmuDict): ExpectedTokenFormProvider {
  return {
    id: "cmudict",
    formsForToken(
      token: string,
      context: ExpectedTokenFormProviderContext,
    ): readonly string[] {
      const key = normalizeLexiconKey(token);
      if (!key || !context.closedVocabulary.has(key)) return [];
      return buildCmuDictSurfacesOnly(key, dict);
    },
  };
}

/** Lazy singleton provider backed by the shared CMUdict cache. */
let cachedProvider: ExpectedTokenFormProvider | null = null;

export async function getCmuDictProvider(): Promise<ExpectedTokenFormProvider> {
  if (cachedProvider) return cachedProvider;
  const dict = await loadCmuDict();
  cachedProvider = createCmuDictProvider(dict);
  return cachedProvider;
}

export function createCmuDictProviderFromDict(
  dict: CmuDict,
): ExpectedTokenFormProvider {
  return createCmuDictProvider(dict);
}

/** @deprecated Import from `@/helper/speech/expectedTokenForms/cmuDictProvider`. */
export const buildTokenMatchForms = buildCmuDictTokenForms;
