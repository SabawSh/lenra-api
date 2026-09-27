import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { toJsonStringArray } from "@/lib/db/jsonStringArray";
import {
  isDuplicateKeyMysqlError,
  updateUserDisplayNameAndUsername,
  updateUserLearningPreferences,
  updateUserProfileName,
  type EnglishLevel,
} from "@/lib/db/queries/users";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const VALID_ENGLISH_LEVELS = [
  "beginner",
  "elementary",
  "intermediate",
  "upperIntermediate",
  "advanced",
];
const VALID_CONTENT_PREFS = [
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

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const data = (await req.json()) as Record<string, unknown>;
  const section = data.section;

  if (section === "displayName") {
    const name = String(data.name ?? "").trim().slice(0, 80);
    if (!name) {
      return NextResponse.json({ ok: false, error: "Name cannot be empty" });
    }
    await updateUserProfileName(user.id, name);
  } else if (section === "userInfo") {
    const name = String(data.name ?? "").trim().slice(0, 80);
    const username = String(data.username ?? "").trim().toLowerCase();
    if (!name) {
      return NextResponse.json({ ok: false, error: "Name cannot be empty" });
    }
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json({
        ok: false,
        error: "Username must be 3–30 lowercase letters, numbers or underscores",
      });
    }
    try {
      await updateUserDisplayNameAndUsername({
        userId: user.id,
        name,
        username,
      });
    } catch (e: unknown) {
      if (isDuplicateKeyMysqlError(e)) {
        return NextResponse.json({ ok: false, error: "That username is already taken" });
      }
      throw e;
    }
  } else if (section === "learningPrefs") {
    const englishLevel = String(data.englishLevel ?? "");
    const contentPrefs = Array.isArray(data.contentPrefs)
      ? data.contentPrefs.filter((p): p is string => typeof p === "string")
      : [];
    const dailyGoalMinutes = Number(data.dailyGoalMinutes);
    if (!VALID_ENGLISH_LEVELS.includes(englishLevel)) {
      return NextResponse.json({ ok: false, error: "Invalid level" });
    }
    const filteredPrefs = contentPrefs.filter((p) =>
      VALID_CONTENT_PREFS.includes(p),
    );
    if (dailyGoalMinutes < 1 || dailyGoalMinutes > 180) {
      return NextResponse.json({ ok: false, error: "Invalid daily goal" });
    }
    await updateUserLearningPreferences({
      userId: user.id,
      englishLevel: englishLevel as EnglishLevel,
      contentPrefsJson: toJsonStringArray(filteredPrefs),
      dailyGoalMinutes,
    });
  } else {
    return NextResponse.json({ ok: false, error: "Invalid section" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
