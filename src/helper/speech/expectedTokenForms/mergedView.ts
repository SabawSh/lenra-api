import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { CmuDict } from "@/helper/speech/cmuDictLookup";
import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type { TokenKnowledgeBase } from "@/helper/voiceMatching/tokenKnowledgeBase/types";
import { createCmuDictProviderFromDict } from "./cmuDictProvider";
import { createOrthographicProvider } from "./orthographicProvider";
import { createTokenKnowledgeProvider } from "./tokenKnowledgeProvider";
import { createVariantFormProvider } from "./variantFormProvider";
import {
  closedVocabularyFromTokens,
  mergeExpectedTokenForms,
} from "./mergeForms";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

function normalizeKey(token: string): string {
  return normalizeSpeechToken(token);
}

export const CANONICAL_FORM_PROVIDERS = (
  dict: CmuDict,
): readonly ExpectedTokenFormProvider[] => [
  createOrthographicProvider(),
  createVariantFormProvider(),
  createCmuDictProviderFromDict(dict),
];

export function buildCanonicalLexicon(
  tokens: Iterable<string>,
  dict: CmuDict,
): VoiceMatchLexicon {
  return buildLexiconFromProviders(tokens, CANONICAL_FORM_PROVIDERS(dict));
}

export function buildLexiconFromProviders(
  tokens: Iterable<string>,
  providers: readonly ExpectedTokenFormProvider[],
): VoiceMatchLexicon {
  const closedVocabulary = closedVocabularyFromTokens(tokens);
  const context: ExpectedTokenFormProviderContext = { closedVocabulary };
  const lexicon = new Map<string, readonly string[]>();

  for (const token of closedVocabulary) {
    const forms = mergeExpectedTokenForms(providers, token, context);
    if (forms.length > 0) {
      lexicon.set(token, forms);
    }
  }

  return lexicon;
}

function mergeLayeredForms(
  canonicalForms: readonly string[],
  learnedForms: readonly string[],
  orthographicKey: string,
): readonly string[] {
  if (learnedForms.length === 0) return canonicalForms;

  const combined = new Set<string>(canonicalForms);
  for (const form of learnedForms) {
    const normalized = normalizeKey(form);
    if (normalized) combined.add(normalized);
  }

  const forms = [...combined];
  forms.sort((left, right) => {
    if (left === orthographicKey) return -1;
    if (right === orthographicKey) return 1;
    return left.localeCompare(right);
  });
  return forms;
}

/**
 * Read-only merged view: canonical lexicon + learned provider.
 * Learned forms are never written back into the canonical map.
 */
export function buildMergedLexiconView(
  canonicalLexicon: VoiceMatchLexicon,
  tokenKnowledge: TokenKnowledgeBase,
): VoiceMatchLexicon {
  const entries = tokenKnowledge.getEntries();
  if (entries.length === 0) return canonicalLexicon;

  const learned = createTokenKnowledgeProvider(tokenKnowledge);
  const closedVocabulary = new Set(canonicalLexicon.keys());
  const context: ExpectedTokenFormProviderContext = { closedVocabulary };
  const merged = new Map<string, readonly string[]>();

  for (const key of closedVocabulary) {
    const canonicalForms = canonicalLexicon.get(key) ?? [key];
    const learnedForms = learned.formsForToken(key, context);
    merged.set(key, mergeLayeredForms(canonicalForms, learnedForms, key));
  }

  return merged;
}

/** @deprecated Use buildMergedLexiconView. */
export function mergeCanonicalWithTokenKnowledge(
  canonicalLexicon: VoiceMatchLexicon,
  tokenKnowledge: TokenKnowledgeBase,
): VoiceMatchLexicon {
  return buildMergedLexiconView(canonicalLexicon, tokenKnowledge);
}

/** @deprecated Use buildMergedLexiconView. */
export function resolveTokenMatchLexicon(
  canonicalLexicon: VoiceMatchLexicon | undefined,
  tokenKnowledge: TokenKnowledgeBase,
): VoiceMatchLexicon | undefined {
  if (!canonicalLexicon) return undefined;
  return buildMergedLexiconView(canonicalLexicon, tokenKnowledge);
}

export function buildTokenMatchLexiconFromCmuDict(
  tokens: Iterable<string>,
  dict: Parameters<typeof createCmuDictProviderFromDict>[0],
): VoiceMatchLexicon {
  return buildCanonicalLexicon(tokens, dict);
}
