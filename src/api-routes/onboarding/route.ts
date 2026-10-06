import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { toJsonStringArray } from "@/lib/db/jsonStringArray";
import {
  existsOtherUsername,
  updateUserOnboardingSlice,
  type EnglishLevel,
  type UpdateOnboardingPayload,
} from "@/lib/db/queries/users";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const VALID_ENGLISH_LEVELS: EnglishLevel[] = [
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

/**
 * PATCH /api/onboarding
 * Saves onboarding data (can be called per-step or all at once).
 * Body fields are all optional so steps can be submitted individually.
 */
export async function PATCH(req: Request) {
  const session = await readSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: UpdateOnboardingPayload = {};

  if (typeof body.username === "string") {
    const username = body.username.toLowerCase().trim();
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json({ error: "invalid_username" }, { status: 400 });
    }
    const taken = await existsOtherUsername(username, session.userId);
    if (taken) {
      return NextResponse.json({ error: "username_taken" }, { status: 409 });
    }
    patch.username = username;
  }

  if (
    typeof body.englishLevel === "string" &&
    VALID_ENGLISH_LEVELS.includes(body.englishLevel as EnglishLevel)
  ) {
    patch.englishLevel = body.englishLevel as EnglishLevel;
  }

  if (Array.isArray(body.contentPrefs)) {
    const filtered = (body.contentPrefs as unknown[])
      .filter(
        (p): p is string =>
          typeof p === "string" && VALID_CONTENT_PREFS.includes(p),
      )
      .slice(0, 10);
    patch.contentPrefsJson = toJsonStringArray(filtered);
  }

  if (
    typeof body.dailyGoalMinutes === "number" &&
    body.dailyGoalMinutes > 0 &&
    body.dailyGoalMinutes <= 120
  ) {
    patch.dailyGoalMinutes = Math.round(body.dailyGoalMinutes);
  }

  if (body.complete === true) {
    patch.onboardingCompletedAt = new Date();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_valid_fields" }, { status: 400 });
  }

  const user = await updateUserOnboardingSlice(session.userId, patch);
  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  // Seed Adaptive Teacher ability once from onboarding level; never overwrite later.
  if (patch.englishLevel !== undefined) {
    const { seedOverallSkillFromOnboardingIfAbsent } = await import(
      "@/lib/db/queries/userAdaptiveSkill"
    );
    await seedOverallSkillFromOnboardingIfAbsent(session.userId);
  }

  revalidateTag("user", { expire: 0 });

  return NextResponse.json({ ok: true, user });
}
