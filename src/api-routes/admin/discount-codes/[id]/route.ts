import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import {
  updateDiscountCode,
  type DiscountCodePatch,
} from "@/lib/db/queries/discountCodes";

/**
 * PATCH /api/admin/discount-codes/:id
 * Body: { isActive?, description?, endsAt?, maxRedemptions? }
 *
 * Discount amount, plans and per-user rules are fixed once a code exists
 * (people may already hold it); create a new code instead.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: DiscountCodePatch = {};
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be boolean." }, { status: 400 });
    }
    patch.isActive = body.isActive;
  }
  if ("description" in body) {
    patch.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 255)
        : null;
  }
  if ("endsAt" in body) {
    if (body.endsAt === null || body.endsAt === "") {
      patch.endsAt = null;
    } else {
      const d = new Date(String(body.endsAt));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid end date." }, { status: 400 });
      }
      patch.endsAt = d;
    }
  }
  if ("maxRedemptions" in body) {
    if (body.maxRedemptions === null || body.maxRedemptions === "") {
      patch.maxRedemptions = null;
    } else {
      const n = Number(body.maxRedemptions);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "Total uses must be a positive whole number." },
          { status: 400 },
        );
      }
      patch.maxRedemptions = n;
    }
  }

  const updated = await updateDiscountCode(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found or nothing to update." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
