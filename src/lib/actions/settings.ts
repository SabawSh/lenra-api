"use server";

import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { toJsonStringArray } from "@/lib/db/jsonStringArray";
import {
  isDuplicateKeyMysqlError,
  updateUserDisplayNameAndUsername,
  updateUserLearningPreferences,
  type EnglishLevel,
} from "@/lib/db/queries/users";
import { revalidateTag } from "next/cache";

export type UpdateSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

const VALID_ENGLISH_LEVELS: readonly string[] = [
  "beginner",
  "elementary",
  "intermediate",
  "upperIntermediate",
  "advanced",
];

const VALID_CONTENT_PREFS: readonly string[] = [
  "series",
  "movies",
  "documentaries",
  "comedy",
  "drama",
  "action",
  "scifi",
  "romance",
  "thriller",
  "animation",
];

type SettingsUpdate =
  | { section: "userInfo"; name: string; username: string }
  | {
      section: "learningPrefs";
      englishLevel: string;
      contentPrefs: string[];
      dailyGoalMinutes: number;
    };

export async function updateSettings(
  data: SettingsUpdate,
): Promise<UpdateSettingsResult> {
  const session = await readSessionFromCookies();
  if (!session) return { ok: false, error: "Not authenticated" };

  if (data.section === "userInfo") {
    const name = data.name.trim().slice(0, 80);
    const username = data.username.trim().toLowerCase();

    if (!name) return { ok: false, error: "Name cannot be empty" };
    if (!USERNAME_RE.test(username)) {
      return {
        ok: false,
        error:
          "Username must be 3–30 lowercase letters, numbers or underscores",
      };
    }

    try {
      await updateUserDisplayNameAndUsername({
        userId: session.userId,
        name,
        username,
      });
    } catch (e: unknown) {
      if (isDuplicateKeyMysqlError(e)) {
        return { ok: false, error: "That username is already taken" };
      }
      throw e;
    }
  } else {
    if (!VALID_ENGLISH_LEVELS.includes(data.englishLevel)) {
      return { ok: false, error: "Invalid level" };
    }
    const contentPrefs = data.contentPrefs.filter((p) =>
      VALID_CONTENT_PREFS.includes(p),
    );
    if (data.dailyGoalMinutes < 1 || data.dailyGoalMinutes > 180) {
      return { ok: false, error: "Invalid daily goal" };
    }

    const contentPrefsJson = toJsonStringArray(contentPrefs);

    await updateUserLearningPreferences({
      userId: session.userId,
      englishLevel: data.englishLevel as EnglishLevel,
      contentPrefsJson,
      dailyGoalMinutes: data.dailyGoalMinutes,
    });
    const { seedOverallSkillFromOnboardingIfAbsent } = await import(
      "@/lib/db/queries/userAdaptiveSkill"
    );
    await seedOverallSkillFromOnboardingIfAbsent(session.userId);
  }

  revalidateTag("user", { expire: 0 });
  return { ok: true };
}
