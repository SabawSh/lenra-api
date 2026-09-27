import { hasAcceptedLatestLegal } from "@/lib/legal/hasAcceptedLatestLegal";
import type { UserLegalSlice } from "@/lib/legal/types";
import { redirect } from "next/navigation";

function sanitizeNext(next: string | null | undefined): string {
  const n = typeof next === "string" ? next.trim() : "";
  if (n.startsWith("/") && !n.startsWith("//")) return n;
  return "/dashboard";
}

/**
 * Redirects authenticated users who have not accepted the latest legal docs.
 * Call from RSC layouts/pages after confirming the user is signed in.
 */
export function requireLegalAcceptance(
  user: UserLegalSlice,
  options?: { next?: string | null },
): void {
  if (hasAcceptedLatestLegal(user)) return;

  const intended = sanitizeNext(options?.next);
  const params = new URLSearchParams({ next: intended });
  redirect(`/legal/accept?${params.toString()}`);
}
