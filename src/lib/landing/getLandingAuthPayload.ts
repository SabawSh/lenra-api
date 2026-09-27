import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getTranslations } from "next-intl/server";

/**
 * Deduped within a single navigation so header + hero + CTA shells share one DB hit.
 */
export const getLandingAuthPayload = cache(async () => {
  const [t, user] = await Promise.all([
    getTranslations("landing"),
    getCurrentUser(),
  ]);
  return { t, user, isSignedIn: Boolean(user) };
});
