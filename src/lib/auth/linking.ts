/**
 * Account linking — dual verified ownership only.
 *
 * We never link by username (public, guessable) or by email/phone alone
 * (not proof the requester controls the other provider). Linking requires:
 *   • OTP-verified phone (pending token or fresh verify), and
 *   • Google OAuth with a stable `sub` on an existing Lenra user.
 *
 * That blocks silent merges and takeover via matching handles or emails.
 */
import {
  findAuthMethodByProviderAccount,
  insertGoogleAuthMethod,
  insertPhoneAuthMethod,
  isAuthMethodDuplicateError,
  listAuthMethodsForUser,
  syncUserIdentityFromAuthMethods,
  type AuthProvider,
  type UserAuthMethod,
} from "@/lib/db/queries/authMethods";
import {
  findUserByGoogleId,
  getUserById,
  insertUserViaGoogleSignup,
  insertUserViaPhoneSignup,
  updateUserGoogleLinkedAccount,
  type User,
} from "@/lib/db/queries/users";
import { pool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";
import type { UserId } from "@/types/schema";

export type LinkErrorCode =
  | "phone_linked_elsewhere"
  | "google_linked_elsewhere"
  | "google_account_not_found"
  | "duplicate_provider"
  | "user_not_found"
  | "last_method"
  | "unknown";

export type LinkResult =
  | { ok: true; user: User }
  | { ok: false; code: LinkErrorCode };

/** Lazy-backfill auth row from legacy `users.google_id` when migration not applied yet. */
async function legacyGoogleUserId(googleSub: string): Promise<UserId | null> {
  const user = await findUserByGoogleId(googleSub);
  if (!user) return null;
  try {
    await insertGoogleAuthMethod({
      userId: user.id,
      googleSub,
      email: user.email,
      verifiedAt: user.emailVerifiedAt ?? user.createdAt,
    });
  } catch (e) {
    if (!isAuthMethodDuplicateError(e)) throw e;
  }
  return user.id;
}

async function legacyPhoneUserId(phone: string): Promise<UserId | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE phone = ? LIMIT 1`,
    [phone],
  );
  const id = rows[0]?.id;
  if (typeof id !== "string") return null;
  try {
    await insertPhoneAuthMethod({
      userId: id as UserId,
      phone,
      verifiedAt: new Date(),
    });
  } catch (e) {
    if (!isAuthMethodDuplicateError(e)) throw e;
  }
  return id as UserId;
}

export async function resolveUserIdFromGoogleSub(
  googleSub: string,
): Promise<UserId | null> {
  const method = await findAuthMethodByProviderAccount("google", googleSub);
  if (method) return method.userId;
  return legacyGoogleUserId(googleSub);
}

export async function resolveUserIdFromVerifiedPhone(
  phone: string,
): Promise<UserId | null> {
  const method = await findAuthMethodByProviderAccount("phone", phone);
  if (method) return method.userId;
  return legacyPhoneUserId(phone);
}

/**
 * After OTP: attach a verified phone to the Google-authenticated user.
 * Both sides must already be verified (OTP + Google OAuth).
 */
export async function linkVerifiedPhoneToUser(
  userId: UserId,
  phone: string,
  verifiedAt: Date,
): Promise<LinkResult> {
  const existingPhone = await findAuthMethodByProviderAccount("phone", phone);
  if (existingPhone && existingPhone.userId !== userId) {
    return { ok: false, code: "phone_linked_elsewhere" };
  }

  const userMethods = await listAuthMethodsForUser(userId);
  const alreadyOnUser = userMethods.some(
    (m) => m.provider === "phone" && m.providerAccountId === phone,
  );

  if (!alreadyOnUser) {
    try {
      await insertPhoneAuthMethod({ userId, phone, verifiedAt });
    } catch (e) {
      if (isAuthMethodDuplicateError(e)) {
        const again = await findAuthMethodByProviderAccount("phone", phone);
        if (again && again.userId !== userId) {
          return { ok: false, code: "phone_linked_elsewhere" };
        }
      } else {
        throw e;
      }
    }
  }

  await syncUserIdentityFromAuthMethods(userId);
  const user = await getUserById(userId);
  if (!user) return { ok: false, code: "user_not_found" };
  return { ok: true, user };
}

/**
 * Attach Google to an existing user (e.g. phone-first account in settings).
 */
export async function linkGoogleToUser(
  userId: UserId,
  params: {
    googleSub: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
    emailVerifiedAt: Date | null;
    verifiedAt: Date;
  },
): Promise<LinkResult> {
  const existingGoogle = await findAuthMethodByProviderAccount(
    "google",
    params.googleSub,
  );
  if (existingGoogle && existingGoogle.userId !== userId) {
    return { ok: false, code: "google_linked_elsewhere" };
  }

  const userMethods = await listAuthMethodsForUser(userId);
  const hasGoogle = userMethods.some((m) => m.provider === "google");
  if (!hasGoogle) {
    try {
      await insertGoogleAuthMethod({
        userId,
        googleSub: params.googleSub,
        email: params.email,
        verifiedAt: params.verifiedAt,
      });
    } catch (e) {
      if (isAuthMethodDuplicateError(e)) {
        const again = await findAuthMethodByProviderAccount(
          "google",
          params.googleSub,
        );
        if (again && again.userId !== userId) {
          return { ok: false, code: "google_linked_elsewhere" };
        }
      } else {
        throw e;
      }
    }
  }

  await updateUserGoogleLinkedAccount(userId, {
    googleId: params.googleSub,
    email: params.email ?? undefined,
    name: params.name ?? undefined,
    avatarUrl: params.avatarUrl ?? undefined,
    emailVerifiedAt: params.emailVerifiedAt ?? undefined,
    lastActive: params.verifiedAt,
  });
  await syncUserIdentityFromAuthMethods(userId);

  const user = await getUserById(userId);
  if (!user) return { ok: false, code: "user_not_found" };
  return { ok: true, user };
}

export async function loginOrRegisterViaGoogle(params: {
  googleSub: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  lastActive: Date;
}): Promise<{ user: User; isNewUser: boolean }> {
  const existingId = await resolveUserIdFromGoogleSub(params.googleSub);
  if (existingId) {
    const updated = await updateUserGoogleLinkedAccount(existingId, {
      googleId: params.googleSub,
      email: params.email ?? undefined,
      name: params.name ?? undefined,
      avatarUrl: params.avatarUrl ?? undefined,
      emailVerifiedAt: params.emailVerifiedAt ?? undefined,
      lastActive: params.lastActive,
    });
    if (!updated) throw new Error("google user update failed");
    await syncUserIdentityFromAuthMethods(existingId);
    return { user: updated, isNewUser: false };
  }

  const user = await insertUserViaGoogleSignup({
    googleId: params.googleSub,
    email: params.email,
    name: params.name,
    avatarUrl: params.avatarUrl,
    emailVerifiedAt: params.emailVerifiedAt,
    lastActive: params.lastActive,
  });
  await insertGoogleAuthMethod({
    userId: user.id,
    googleSub: params.googleSub,
    email: params.email,
    verifiedAt: params.emailVerifiedAt ?? params.lastActive,
  });
  await syncUserIdentityFromAuthMethods(user.id);
  return { user, isNewUser: true };
}

export async function registerViaVerifiedPhone(params: {
  phone: string;
  phoneVerifiedAt: Date;
}): Promise<LinkResult> {
  const taken = await findAuthMethodByProviderAccount("phone", params.phone);
  if (taken) return { ok: false, code: "duplicate_provider" };

  try {
    const user = await insertUserViaPhoneSignup({
      phone: params.phone,
      phoneVerifiedAt: params.phoneVerifiedAt,
      lastActive: params.phoneVerifiedAt,
    });
    await insertPhoneAuthMethod({
      userId: user.id,
      phone: params.phone,
      verifiedAt: params.phoneVerifiedAt,
    });
    await syncUserIdentityFromAuthMethods(user.id);
    return { ok: true, user };
  } catch (e) {
    if (isAuthMethodDuplicateError(e)) {
      return { ok: false, code: "duplicate_provider" };
    }
    throw e;
  }
}

export async function loginViaVerifiedPhone(
  phone: string,
  lastActive: Date,
): Promise<User | null> {
  const userId = await resolveUserIdFromVerifiedPhone(phone);
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  await syncUserIdentityFromAuthMethods(userId);
  return getUserById(userId);
}

export async function removeAuthMethodForUser(
  userId: UserId,
  provider: AuthProvider,
): Promise<LinkResult> {
  const methods = await listAuthMethodsForUser(userId);
  if (methods.length <= 1) {
    return { ok: false, code: "last_method" };
  }
  const target = methods.find((m) => m.provider === provider);
  if (!target) {
    const user = await getUserById(userId);
    if (!user) return { ok: false, code: "user_not_found" };
    return { ok: true, user };
  }

  const { pool } = await import("@/lib/db/connection");
  await pool.execute(
    `DELETE FROM user_auth_methods WHERE id = ? AND user_id = ?`,
    [target.id, userId],
  );
  await syncUserIdentityFromAuthMethods(userId);
  const user = await getUserById(userId);
  if (!user) return { ok: false, code: "user_not_found" };
  return { ok: true, user };
}

export function summarizeAuthMethods(methods: UserAuthMethod[]): {
  google: boolean;
  phone: boolean;
  googleEmail: string | null;
  phoneNumber: string | null;
} {
  const google = methods.find((m) => m.provider === "google");
  const phone = methods.find((m) => m.provider === "phone");
  return {
    google: Boolean(google),
    phone: Boolean(phone),
    googleEmail: google?.email ?? null,
    phoneNumber: phone?.phone ?? null,
  };
}
