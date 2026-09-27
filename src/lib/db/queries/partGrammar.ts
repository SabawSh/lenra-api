
import { pool } from "@/lib/db/connection";
import {
  loadGrammarForPartIds,
  MAX_PART_IDS,
} from "@/lib/learning/loadGrammarForParts";
import type { GrammarForPartsResult } from "@/lib/learning/grammarForParts";

/**
 * Next.js learner path — uses the app connection pool.
 */
export async function getGrammarForPartIds(
  partIds: string[],
): Promise<GrammarForPartsResult> {
  return loadGrammarForPartIds(partIds, pool);
}

export { MAX_PART_IDS };
