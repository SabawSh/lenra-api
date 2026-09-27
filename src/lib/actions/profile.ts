"use server";

import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { toJsonStringArray } from "@/lib/db/jsonStringArray";
import {
  updateUserLearningPreferences,
  updateUserProfileName,
  type EnglishLevel,
} from "@/lib/db/queries/users";
import { revalidateTag } from "next/cache";

export type UpdateProfileResult = { ok: true } | { ok: false; error: string };

type ProfileUpdate =
  | { section: "userInfo"; name: string }
  | {
      section: "learningPrefs";
      englishLevel: string;
      contentPrefs: string[];
      dailyGoalMinutes: number;
    };

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

export async function updateProfile(
  data: ProfileUpdate,
): Promise<UpdateProfileResult> {
  const session = await readSessionFromCookies();
  if (!session) return { ok: false, error: "Not authenticated" };

  if (data.section === "userInfo") {
    const name = data.name.trim().slice(0, 80);
    if (!name) return { ok: false, error: "Name cannot be empty" };

    await updateUserProfileName(session.userId, name);
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
  }

  revalidateTag("user", { expire: 0 });
  return { ok: true };
}
