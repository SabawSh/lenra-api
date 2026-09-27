/**
 * Phone-OTP helpers.
 *
 * Flow:
 * 1. `requestPhoneOtp(phone)` — generate a random 6-digit code, persist a hash,
 *    and send the raw code via SMS. Old/unconsumed codes for the same phone are
 *    invalidated so a user can re-request without ambiguity.
 * 2. `verifyPhoneOtp(phone, code)` — pull the most recent active code, compare
 *    against the hash, mark it consumed on success, bump attempts on failure.
 *
 * The codes themselves are stored only as bcrypt hashes; raw codes never touch
 * the DB.
 */
import bcrypt from "bcryptjs";
import {
  consumeAllUnconsumedPhoneVerifications,
  findLatestUnconsumedPhoneVerification,
  incrementPhoneVerificationAttempts,
  insertPhoneVerification,
  markPhoneVerificationConsumed,
} from "@/lib/db/queries/auth";
import { normalizeIranPhone } from "./phone";
import { sendOtpLookup } from "./sms";

export { normalizeIranPhone } from "./phone";

/** TTL for an OTP — short enough to be safe, long enough to type comfortably. */
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** How many wrong submissions we tolerate before forcing a new code. */
const OTP_MAX_ATTEMPTS = 5;
/** Throttle: reject re-requests faster than this. Mirrors the UI countdown. */
const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

export type OtpRequestResult =
  | { ok: true; expiresAt: Date; debugCode?: string }
  | { ok: false; reason: "cooldown"; retryAfterMs: number }
  | { ok: false; reason: "sms_failed"; error: string };

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "not_found" | "invalid" | "max_attempts" };

function generateCode(): string {
  const n = Math.floor(Math.random() * 1_000_000);
  return n.toString().padStart(6, "0");
}

export async function requestPhoneOtp(
  phone: string,
): Promise<OtpRequestResult> {
  const recent = await findLatestUnconsumedPhoneVerification(phone);

  if (recent) {
    const sinceMs = Date.now() - recent.created_at.getTime();
    if (sinceMs < OTP_RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterMs: OTP_RESEND_COOLDOWN_MS - sinceMs,
      };
    }
  }

  await consumeAllUnconsumedPhoneVerifications(phone, new Date());

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await insertPhoneVerification({ phone, codeHash, expiresAt });

  const sms = await sendOtpLookup({ to: phone, token: code });
  if (!sms.ok) {
    return { ok: false, reason: "sms_failed", error: sms.error };
  }

  return {
    ok: true,
    expiresAt,
    debugCode: sms.devEcho ? code : undefined,
  };
}

export async function verifyPhoneOtp(
  phone: string,
  code: string,
): Promise<OtpVerifyResult> {
  const record = await findLatestUnconsumedPhoneVerification(phone);

  if (!record) return { ok: false, reason: "not_found" };

  const now = new Date();

  if (record.expires_at.getTime() < Date.now()) {
    await markPhoneVerificationConsumed(record.id, now);
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await markPhoneVerificationConsumed(record.id, now);
    return { ok: false, reason: "max_attempts" };
  }

  const matches = await bcrypt.compare(code, record.code_hash);
  if (!matches) {
    await incrementPhoneVerificationAttempts(record.id);
    return { ok: false, reason: "invalid" };
  }

  await markPhoneVerificationConsumed(record.id, now);
  return { ok: true };
}

