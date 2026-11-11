import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import {
  createDiscountCode,
  listDiscountCodesForAdmin,
} from "@/lib/db/queries/discountCodes";
import { parseDiscountCodeInput } from "@/lib/payments/discounts";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, user };
}

/** GET /api/admin/discount-codes — every code with usage stats. */
export async function GET() {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;
  const codes = await listDiscountCodesForAdmin();
  return NextResponse.json({ ok: true, codes });
}

/** POST /api/admin/discount-codes — create a code. */
export async function POST(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseDiscountCodeInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const created = await createDiscountCode(parsed.input, admin.user.id);
  if (!created.ok) {
    return NextResponse.json(
      { error: "A code with this name already exists." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
