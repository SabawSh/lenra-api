import { expectedTokenKey } from "./normalizeToken";
import { SEED_TOKEN_KNOWLEDGE } from "./seed";
import {
  TOKEN_KNOWLEDGE_SCHEMA_VERSION,
  type TokenKnowledgeBase,
  type TokenKnowledgeEntry,
} from "./types";

function normalizeEntry(entry: TokenKnowledgeEntry): TokenKnowledgeEntry {
  return {
    schemaVersion: entry.schemaVersion ?? TOKEN_KNOWLEDGE_SCHEMA_VERSION,
    expectedToken: entry.expectedToken,
    promotedForms: entry.promotedForms.map((form) => ({
      ...form,
      promotedAt: form.promotedAt ?? form.createdAt,
      lastMatched: form.lastMatched ?? null,
      successfulMatches: form.successfulMatches ?? 0,
      rejectedMatches: form.rejectedMatches ?? 0,
    })),
  };
}

function cloneEntry(entry: TokenKnowledgeEntry): TokenKnowledgeEntry {
  return normalizeEntry({
    expectedToken: entry.expectedToken,
    schemaVersion: entry.schemaVersion,
    promotedForms: entry.promotedForms.map((form) => ({ ...form })),
  });
}

/**
 * In-memory token knowledge base.
 * Returns promoted STT observation forms only — no matching or rescue logic.
 */
export class InMemoryTokenKnowledgeBase implements TokenKnowledgeBase {
  private readonly entries = new Map<string, TokenKnowledgeEntry>();

  constructor(seed: readonly TokenKnowledgeEntry[] = SEED_TOKEN_KNOWLEDGE) {
    for (const entry of seed) {
      const key = expectedTokenKey(entry.expectedToken);
      if (!key) continue;
      this.entries.set(key, cloneEntry(entry));
    }
  }

  lookup(expectedToken: string): TokenKnowledgeEntry | null {
    const key = expectedTokenKey(expectedToken);
    if (!key) return null;

    const entry = this.entries.get(key);
    if (!entry) return null;

    return cloneEntry(entry);
  }

  getEntries(): readonly TokenKnowledgeEntry[] {
    return [...this.entries.values()].map((entry) => cloneEntry(entry));
  }
}

export function createInMemoryTokenKnowledgeBase(
  seed: readonly TokenKnowledgeEntry[] = SEED_TOKEN_KNOWLEDGE,
): InMemoryTokenKnowledgeBase {
  return new InMemoryTokenKnowledgeBase(seed);
}

export function tokenKnowledgeEntriesEqual(
  left: readonly TokenKnowledgeEntry[],
  right: readonly TokenKnowledgeEntry[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
