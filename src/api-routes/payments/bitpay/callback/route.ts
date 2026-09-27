import { verifyBitpayPayment } from "@/lib/payments/bitpay";
import { verifyCheckoutState } from "@/lib/payments/checkoutState";
import { activateUserSubscription } from "@/lib/db/queries/subscriptions";
import { getBitpayPublicOrigin, pricingUrl } from "@/lib/payments/publicOrigin";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = getBitpayPublicOrigin(req);
  const state = url.searchParams.get("state") ?? "";
  const checkout = verifyCheckoutState(state);

  if (!checkout) {
    return NextResponse.redirect(
      pricingUrl("fa", origin, new URLSearchParams({ payment: "invalid_state" })),
    );
  }

  const { userId, plan, locale } = checkout;
  const idTrans = Number(url.searchParams.get("trans_id"));
  const getId = Number(url.searchParams.get("id_get"));

  if (!Number.isInteger(idTrans) || idTrans <= 0) {
    return NextResponse.redirect(
      pricingUrl(locale, origin, new URLSearchParams({ payment: "invalid_trans" })),
    );
  }
  if (!Number.isInteger(getId) || getId <= 0) {
    return NextResponse.redirect(
      pricingUrl(locale, origin, new URLSearchParams({ payment: "invalid_get" })),
    );
  }

  try {
    const verify = await verifyBitpayPayment({ idTrans, getId });
    if (verify.status === 1 || verify.status === 11) {
      await activateUserSubscription({
        userId,
        planKey: plan,
        idTrans,
        getId,
      });
      return NextResponse.redirect(
        pricingUrl(
          locale,
          origin,
          new URLSearchParams({ payment: "success", plan }),
        ),
      );
    }
    return NextResponse.redirect(
      pricingUrl(
        locale,
        origin,
        new URLSearchParams({
          payment: "failed",
          status: String(verify.status),
        }),
      ),
    );
  } catch {
    return NextResponse.redirect(
      pricingUrl(locale, origin, new URLSearchParams({ payment: "verify_error" })),
    );
  }
}
