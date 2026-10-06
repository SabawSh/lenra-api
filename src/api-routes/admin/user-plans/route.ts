import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { normalizeIranPhone } from "@/lib/auth/phone";
import {
  adminUpdateUserBasics,
  deleteUserById,
  getUserById,
  listUsersForAdmin,
  setUserSiteAdminFlag,
} from "@/lib/db/queries/users";
import { adminGrantUserSubscription } from "@/lib/db/queries/subscriptions";
import { isUserId } from "@/lib/db/userId";
import { isBitpayPlanKey } from "@/lib/payments/plans";
import type { BitpayPlanKey } from "@/lib/payments/plans";
import type { UserId } from "@/types/schema";

type UserLookupResult = {
  id: UserId;
  username: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
};

function isEmailLike(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

async function resolveUserLookupTerm(
  term: string,
): Promise<UserLookupResult | null> {
  const rows = await listUsersForAdmin({ query: term, limit: 1 });
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    phone: row.phone,
    name: row.name,
  };
}

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return { ok: false as const, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

/**
 * GET  /api/admin/user-plans?q=...
 * Resolve a user from an id/email/phone/username for the admin UI.
 *
 * POST /api/admin/user-plans
 * Body: { userId: string; planKey: 'monthly'|'every6Months'|'yearly' }
 *
 * Admin-only. Creates an active subscription row with `source='admin'`.
 */
export async function GET(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.trim()) {
    const user = await resolveUserLookupTerm(q);
    return NextResponse.json({ ok: true, user });
  }

  const users = await listUsersForAdmin({ limit: 100 });
  return NextResponse.json({ ok: true, users });
}

export async function POST(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!record) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const userIdRaw = record.userId;
  const planKeyRaw = record.planKey;

  if (typeof userIdRaw !== "string" || !isUserId(userIdRaw)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }
  if (typeof planKeyRaw !== "string" || !isBitpayPlanKey(planKeyRaw)) {
    return NextResponse.json({ error: "Invalid planKey" }, { status: 400 });
  }

  const userId = userIdRaw as UserId;
  const planKey = planKeyRaw as BitpayPlanKey;

  const existing = await getUserById(userId);
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const expiresAt = await adminGrantUserSubscription({ userId, planKey });
  return NextResponse.json({ ok: true, expiresAt });
}

export async function PATCH(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!record) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const userIdRaw = record.userId;
  if (typeof userIdRaw !== "string" || !isUserId(userIdRaw)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  if ("isAdmin" in record) {
    if (typeof record.isAdmin !== "boolean") {
      return NextResponse.json({ error: "Invalid isAdmin value" }, { status: 400 });
    }

    try {
      const user = await setUserSiteAdminFlag(userIdRaw, record.isAdmin);
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, user });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const name =
    record.name == null ? null : String(record.name).trim() || null;
  const username =
    record.username == null ? null : String(record.username).trim().toLowerCase() || null;
  const email =
    record.email == null ? null : String(record.email).trim().toLowerCase() || null;
  const phoneRaw =
    record.phone == null ? null : String(record.phone).trim();
  const phone = phoneRaw ? normalizeIranPhone(phoneRaw) : null;
  if (phoneRaw && !phone) {
    return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
  }
  if (email && !isEmailLike(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    const user = await adminUpdateUserBasics({
      userId: userIdRaw,
      name,
      username,
      email,
      phone,
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? "";
  if (!isUserId(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  try {
    const deleted = await deleteUserById(userId);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin/user-plans] DELETE failed", { userId, message });
    return NextResponse.json(
      { error: message || "Delete failed" },
      { status: 500 },
    );
  }
}

