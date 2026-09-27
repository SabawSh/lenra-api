import { ACHIEVEMENT_DEFINITION_SEEDS } from "@/lib/achievements/definitions";
import { upsertAchievementDefinitionSeed } from "@/lib/db/queries/achievements";

let definitionsReady: Promise<void> | null = null;

/** Idempotent upsert of all achievement definitions (safe on every sync). */
export async function ensureAchievementDefinitions(): Promise<void> {
  if (!definitionsReady) {
    definitionsReady = (async () => {
      for (const seed of ACHIEVEMENT_DEFINITION_SEEDS) {
        await upsertAchievementDefinitionSeed(seed);
      }
    })().catch((err) => {
      definitionsReady = null;
      throw err;
    });
  }
  await definitionsReady;
}
