import { verifyBitpayPayment } from "@/lib/payments/bitpay";
import { verifyCheckoutState } from "@/lib/payments/checkoutState";
import { activateUserSubscription } from "@/lib/db/queries/subscriptions";
import {
  completeBitpayOrder,
  getPaymentOrder,
  markOrderFailed,
} from "@/lib/db/queries/paymentOrders";
import {
  isBitpaySuccessStatus,
  matchVerifyToOrder,
} from "@/lib/payments/orderVerification";
import { getPlanAmountRial } from "@/lib/payments/plans";
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

  const { userId, plan, locale, orderId } = checkout;
  const redirect = (params: Record<string, string>) =>
    NextResponse.redirect(
      pricingUrl(locale, origin, new URLSearchParams(params)),
    );

  const idTrans = Number(url.searchParams.get("trans_id"));
  const getId = Number(url.searchParams.get("id_get"));

  if (!Number.isInteger(idTrans) || idTrans <= 0) {
    return redirect({ payment: "invalid_trans" });
  }
  if (!Number.isInteger(getId) || getId <= 0) {
    return redirect({ payment: "invalid_get" });
  }

  try {
    if (orderId) {
      const order = await getPaymentOrder(orderId);
      if (
        !order ||
        order.userId !== userId ||
        order.planKey !== plan ||
        order.provider !== "bitpay"
      ) {
        return redirect({ payment: "invalid_state" });
      }
      // id_get must be the one BitPay gave us for this order.
      if (order.bitpayGetId !== null && order.bitpayGetId !== getId) {
        console.warn("[bitpay] callback id_get does not match order", order.id);
        return redirect({ payment: "verify_mismatch" });
      }

      const verify = await verifyBitpayPayment({ idTrans, getId });
      if (!isBitpaySuccessStatus(verify.status)) {
        await markOrderFailed(order.id, verify.status).catch(() => {});
        return redirect({ payment: "failed", status: String(verify.status) });
      }

      const match = matchVerifyToOrder({
        expected: {
          amountRial: order.amountRial,
          factorId: order.factorId,
          getId: order.bitpayGetId,
        },
        callbackGetId: getId,
        verify,
      });
      if (!match.ok) {
        console.warn("[bitpay] verify result does not match order", {
          orderId: order.id,
          reason: match.reason,
        });
        return redirect({ payment: "verify_mismatch" });
      }

      const done = await completeBitpayOrder({
        orderId: order.id,
        idTrans,
        getId,
        bitpayStatus: verify.status,
      });
      if (!done.ok) {
        console.warn("[bitpay] could not complete order", {
          orderId: order.id,
          reason: done.reason,
        });
        return redirect({ payment: "verify_mismatch" });
      }
      return redirect({ payment: "success", plan: order.planKey });
    }

    // Legacy state (minted before payment_orders existed). Only the plan is
    // known, so at least require BitPay's echoed amount to match its price.
    const verify = await verifyBitpayPayment({ idTrans, getId });
    if (!isBitpaySuccessStatus(verify.status)) {
      return redirect({ payment: "failed", status: String(verify.status) });
    }
    const match = matchVerifyToOrder({
      expected: { amountRial: getPlanAmountRial(plan), factorId: null, getId: null },
      callbackGetId: getId,
      verify,
    });
    if (!match.ok) {
      console.warn("[bitpay] legacy verify mismatch", { reason: match.reason });
      return redirect({ payment: "verify_mismatch" });
    }
    await activateUserSubscription({ userId, planKey: plan, idTrans, getId });
    return redirect({ payment: "success", plan });
  } catch (error) {
    console.error("[bitpay] callback failed", error);
    return redirect({ payment: "verify_error" });
  }
}
