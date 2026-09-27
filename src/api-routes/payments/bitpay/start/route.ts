import { createBitpayPayment } from "@/lib/payments/bitpay";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface StartBody {
  amount?: unknown;
  redirect?: unknown;
  name?: unknown;
  email?: unknown;
  description?: unknown;
  factorId?: unknown;
  mobileNum?: unknown;
  cardNum?: unknown;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function POST(req: Request) {
  let body: StartBody | null = null;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const amount = Number(body?.amount);
  if (!Number.isInteger(amount) || amount < 5000) {
    return NextResponse.json(
      { error: "invalid_amount", message: "amount must be an integer >= 5000" },
      { status: 400 },
    );
  }

  const redirect = asOptionalString(body?.redirect);
  if (!redirect) {
    return NextResponse.json(
      { error: "invalid_redirect", message: "redirect is required" },
      { status: 400 },
    );
  }

  const factorId =
    typeof body?.factorId === "number" && Number.isInteger(body.factorId)
      ? body.factorId
      : undefined;

  try {
    const result = await createBitpayPayment({
      amount,
      redirect,
      name: asOptionalString(body?.name),
      email: asOptionalString(body?.email),
      description: asOptionalString(body?.description),
      factorId,
      mobileNum: asOptionalString(body?.mobileNum),
      cardNum: asOptionalString(body?.cardNum),
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "bitpay_start_failed",
          code: result.code,
          message: result.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: "bitpay_unavailable",
        message,
      },
      { status: 502 },
    );
  }
}
