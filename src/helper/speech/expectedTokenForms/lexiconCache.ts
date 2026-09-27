import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { TokenKnowledgeBase } from "@/helper/voiceMatching/tokenKnowledgeBase/types";
import { buildMergedLexiconView } from "./mergedView";

export type VoiceMatchLexiconSession = {
  puzzleKey: string;
  knowledgeRevision: number;
  canonicalLexicon: VoiceMatchLexicon | null;
  mergedLexicon: VoiceMatchLexicon | null;
};

export function createVoiceMatchLexiconSession(): VoiceMatchLexiconSession {
  return {
    puzzleKey: "",
    knowledgeRevision: -1,
    canonicalLexicon: null,
    mergedLexicon: null,
  };
}

/**
 * Cache canonical + merged lexicons for a puzzle.
 * Rebuilds merged only when puzzle key or knowledge revision changes.
 */
export function cacheMergedVoiceMatchLexicon(input: {
  session: VoiceMatchLexiconSession;
  puzzleKey: string;
  canonicalLexicon: VoiceMatchLexicon;
  knowledgeRevision: number;
  tokenKnowledge: TokenKnowledgeBase;
}): VoiceMatchLexicon {
  const {
    session,
    puzzleKey,
    canonicalLexicon,
    knowledgeRevision,
    tokenKnowledge,
  } = input;

  if (
    session.mergedLexicon &&
    session.canonicalLexicon === canonicalLexicon &&
    session.puzzleKey === puzzleKey &&
    session.knowledgeRevision === knowledgeRevision
  ) {
    return session.mergedLexicon;
  }

  const merged = buildMergedLexiconView(
    canonicalLexicon,
    tokenKnowledge,
  );

  session.puzzleKey = puzzleKey;
  session.knowledgeRevision = knowledgeRevision;
  session.canonicalLexicon = canonicalLexicon;
  session.mergedLexicon = merged;

  return merged;
}

/**
 * Rebuild merged lexicon when token knowledge changes but puzzle is unchanged.
 * Returns null when there is no cached canonical lexicon.
 */
export function refreshCachedMergedVoiceMatchLexicon(input: {
  session: VoiceMatchLexiconSession;
  knowledgeRevision: number;
  tokenKnowledge: TokenKnowledgeBase;
}): VoiceMatchLexicon | null {
  const { session, knowledgeRevision, tokenKnowledge } = input;
  if (!session.canonicalLexicon) return null;

  if (
    session.mergedLexicon &&
    session.knowledgeRevision === knowledgeRevision
  ) {
    return session.mergedLexicon;
  }

  return cacheMergedVoiceMatchLexicon({
    session,
    puzzleKey: session.puzzleKey,
    canonicalLexicon: session.canonicalLexicon,
    knowledgeRevision,
    tokenKnowledge,
  });
}

export function clearVoiceMatchLexiconSession(
  session: VoiceMatchLexiconSession,
): void {
  session.puzzleKey = "";
  session.knowledgeRevision = -1;
  session.canonicalLexicon = null;
  session.mergedLexicon = null;
}
