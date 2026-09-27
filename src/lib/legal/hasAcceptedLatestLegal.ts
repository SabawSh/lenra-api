import { CURRENT_LEGAL_VERSION } from "@/lib/legal/legalVersion";
import type { UserLegalSlice } from "@/lib/legal/types";

/** True when both policies are accepted for the current legal version. */
export function hasAcceptedLatestLegal(user: UserLegalSlice): boolean {
  return (
    user.termsAcceptedAt != null &&
    user.privacyAcceptedAt != null &&
    user.legalVersion === CURRENT_LEGAL_VERSION
  );
}
