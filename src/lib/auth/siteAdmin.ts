import { normalizeIranPhone } from "@/lib/auth/phone";

const ADMIN_MEDIA_EMAIL =
  process.env.ADMIN_MEDIA_EMAIL?.trim().toLowerCase() ??
  "sabaw.shokri@gmail.com";

/** Normalized Iranian mobile (+989…); override via `ADMIN_MEDIA_PHONE`. */
function adminMediaPhoneE164(): string {
  return (
    normalizeIranPhone(process.env.ADMIN_MEDIA_PHONE ?? "09308876486") ??
    "+989308876486"
  );
}

/**
 * Returns true when the user is a site media admin.
 *
 * Two paths grant access:
 *  1. Email match — the user's email equals the configured admin email
 *     (Google-verified accounts; no phone required).
 *  2. Phone match — the user's phone equals the configured admin phone AND,
 *     if an email is also set on the account, it must equal the admin email
 *     (original OTP phone-only sign-in path).
 */
export function isSiteMediaAdmin(
  user: { email: string | null; phone: string | null; isSiteAdmin?: boolean | null } | null,
): boolean {
  if (!user) return false;
  if (user.isSiteAdmin === true) return true;

  const emailRaw = user.email?.trim().toLowerCase() ?? "";

  // Path 1: email-based admin (Google sign-in)
  if (emailRaw && emailRaw === ADMIN_MEDIA_EMAIL) return true;

  // Path 2: phone-based admin (OTP sign-in)
  if (!user.phone?.trim()) return false;
  const phoneNorm = normalizeIranPhone(user.phone);
  if (phoneNorm !== adminMediaPhoneE164()) return false;
  // If a secondary email is set on the OTP account, it must also match
  if (emailRaw && emailRaw !== ADMIN_MEDIA_EMAIL) return false;

  return true;
}
