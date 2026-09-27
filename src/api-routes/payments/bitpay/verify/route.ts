import { verifyBitpayPayment } from "@/lib/payments/bitpay";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface VerifyBody {
  id_trans?: unknown;
  get_id?: unknown;
}

export async function POST(req: Request) {
  let body: VerifyBody | null = null;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const idTrans = Number(body?.id_trans);
  const getId = Number(body?.get_id);

  if (!Number.isInteger(idTrans) || idTrans <= 0) {
    return NextResponse.json(
      { error: "invalid_id_trans", message: "id_trans must be integer > 0" },
      { status: 400 },
    );
  }

  if (!Number.isInteger(getId) || getId <= 0) {
    return NextResponse.json(
      { error: "invalid_get_id", message: "get_id must be integer > 0" },
      { status: 400 },
    );
  }

  try {
    const result = await verifyBitpayPayment({ idTrans, getId });

    if (typeof result.status !== "number") {
      return NextResponse.json(
        {
          ok: false,
          error: "bitpay_invalid_response",
          message: "BitPay verify response is missing status",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: result.status === 1 || result.status === 11,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: "bitpay_verify_failed",
        message,
      },
      { status: 502 },
    );
  }
}
