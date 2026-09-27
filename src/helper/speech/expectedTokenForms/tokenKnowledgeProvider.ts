import type { TokenKnowledgeBase } from "@/helper/voiceMatching/tokenKnowledgeBase/types";
import {
  normalizeExpectedToken,
  normalizeObservedToken,
} from "@/helper/voiceMatching/tokenKnowledgeBase/normalizeToken";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

export function createTokenKnowledgeProvider(
  knowledgeBase: TokenKnowledgeBase,
): ExpectedTokenFormProvider {
  return {
    id: "learned",
    formsForToken(
      token: string,
      context: ExpectedTokenFormProviderContext,
    ): readonly string[] {
      const key = normalizeExpectedToken(token);
      if (!key || !context.closedVocabulary.has(key)) return [];

      const entry = knowledgeBase.lookup(key);
      if (!entry) return [];

      const forms = new Set<string>();
      for (const form of entry.promotedForms) {
        const observed = normalizeObservedToken(form.observedToken);
        if (!observed || observed === key) continue;
        forms.add(observed);
      }

      return [...forms];
    },
  };
}
