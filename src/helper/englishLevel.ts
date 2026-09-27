import type { EnglishLevel } from "@/lib/db/queries/users";

export const ENGLISH_LEVEL_CEFR: Record<EnglishLevel, string> = {
  beginner: "A1",
  elementary: "A2",
  intermediate: "B1",
  upperIntermediate: "B2",
  advanced: "C1",
};
