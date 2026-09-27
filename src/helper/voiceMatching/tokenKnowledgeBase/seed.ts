import type { TokenKnowledgeEntry } from "./types";

/**
 * Initial seed data — lookup only; no matching logic here.
 *
 * Starts empty so the matcher behaves identically to pre–token-knowledge builds.
 * Add entries only for validated STT spellings that CMUdict cannot derive.
 */
export const SEED_TOKEN_KNOWLEDGE: readonly TokenKnowledgeEntry[] = [];
