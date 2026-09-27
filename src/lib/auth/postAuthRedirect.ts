import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { hasAcceptedLatestLegal } from "@/lib/legal/hasAcceptedLatestLegal";
import type { UserLegalSlice } from "@/lib/legal/types";

type PostAuthUser = UserLegalSlice & {
  onboardingCompletedAt: Date | null;
  email: string | null;
  phone: string | null;
  isSiteAdmin?: boolean | null;
};

/** Default home after sign-in — admins land on `/admin`, learners on `/dashboard`. */
export function defaultSignedInHomePath(user: PostAuthUser): string {
  if (isSiteMediaAdmin(user)) return "/admin";
  return "/dashboard";
}

function sanitizeNext(
  next: string | null | undefined,
  user: PostAuthUser,
): string {
  const n = typeof next === "string" ? next.trim() : "";
  if (n.startsWith("/") && !n.startsWith("//")) {
    if (n === "/" || n === "/dashboard") {
      return defaultSignedInHomePath(user);
    }
    return n;
  }
  return defaultSignedInHomePath(user);
}

/**
 * Where to send the user immediately after sign-in (Google OAuth or phone OTP).
 * Legal acceptance is enforced before onboarding or the requested destination.
 */
export function postAuthRedirectPath(
  user: PostAuthUser,
  next?: string | null,
  options?: { pushPrompt?: boolean },
): string {
  const intendedAfterLegal = user.onboardingCompletedAt
    ? sanitizeNext(next, user)
    : "/onboarding";

  if (!hasAcceptedLatestLegal(user)) {
    const params = new URLSearchParams({ next: intendedAfterLegal });
    if (options?.pushPrompt && user.onboardingCompletedAt) {
      params.set("push_prompt", "1");
    }
    return `/legal/accept?${params.toString()}`;
  }

  if (!user.onboardingCompletedAt) {
    return "/onboarding";
  }

  let path = sanitizeNext(next, user);
  if (!options?.pushPrompt) return path;

  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}push_prompt=1`;
}
