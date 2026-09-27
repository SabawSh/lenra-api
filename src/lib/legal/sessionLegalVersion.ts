import { hasAcceptedLatestLegal } from "@/lib/legal/hasAcceptedLatestLegal";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal/legalVersion";
import type { UserLegalSlice } from "@/lib/legal/types";

/** JWT `lv` claim value when the user is legally compliant. */
export function legalVersionForSession(user: UserLegalSlice): string | undefined {
  return hasAcceptedLatestLegal(user) ? CURRENT_LEGAL_VERSION : undefined;
}
