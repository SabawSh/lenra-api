/** MySQL ENUM / column shapes — source of truth: `schema.sql`. */

/** Primary key on `users.id` and FK `user_id` columns (UUID v4). */
export type UserId = string;

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type EnglishLevel =
  | "beginner"
  | "elementary"
  | "intermediate"
  | "upperIntermediate"
  | "advanced";

export type VideoType = "series" | "movie" | "documentary";

export type PartDifficulty = "easy" | "medium" | "hard";

export type TokenMarkType = "unknown" | "confused" | "starred";

export type SentenceInputMode = "drag" | "voice";

export type AchievementCategory =
  | "learning"
  | "speaking"
  | "vocabulary"
  | "consistency"
  | "speed"
  | "exploration"
  | "legendary";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";
