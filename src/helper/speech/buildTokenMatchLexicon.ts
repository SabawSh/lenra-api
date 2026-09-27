import {
  buildCanonicalLexicon,
  buildTokenMatchLexiconFromCmuDict,
} from "@/helper/speech/expectedTokenForms";
import { loadCmuDict } from "@/helper/speech/cmuDictLookup";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";

export {
  buildCmuDictTokenForms,
  buildTokenMatchForms,
} from "@/helper/speech/expectedTokenForms/cmuDictProvider";
export {
  buildCanonicalLexicon,
  buildMergedLexiconView,
  buildTokenMatchLexicon,
  buildTokenMatchLexiconFromCmuDict,
  mergeCanonicalWithTokenKnowledge,
  resolveTokenMatchLexicon,
} from "@/helper/speech/expectedTokenForms/buildLexicon";

/** @deprecated Use `buildTokenMatchLexiconFromCmuDict`. */
export const buildVoiceMatchLexiconFromDict = buildTokenMatchLexiconFromCmuDict;

/**
 * Build the canonical session lexicon (orthographic + variant forms + CMUdict).
 * Learned forms are merged separately into the read-only matcher view.
 */
export async function buildVoiceMatchLexicon(
  tokens: Iterable<string>,
): Promise<VoiceMatchLexicon> {
  const dict = await loadCmuDict();
  return buildCanonicalLexicon(tokens, dict);
}

/** Collect every normalized token referenced by puzzle parts. */
export function tokensFromPuzzleParts(
  parts: readonly { tokens: readonly string[] }[],
): string[] {
  const out: string[] = [];
  for (const part of parts) {
    for (const token of part.tokens) {
      out.push(token);
    }
  }
  return out;
}
