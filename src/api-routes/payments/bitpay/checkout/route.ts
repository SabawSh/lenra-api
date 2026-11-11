import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import {
  createPendingBitpayOrder,
  isMissingOrdersTableError,
  markOrderFailed,
  setOrderGatewayId,
  type PaymentOrder,
} from "@/lib/db/queries/paymentOrders";
import {
  evaluateDiscountCode,
  redeemFreeDiscount,
} from "@/lib/db/queries/discountCodes";
import { createBitpayPayment } from "@/lib/payments/bitpay";
import { createCheckoutState } from "@/lib/payments/checkoutState";
import { newFactorId } from "@/lib/payments/orderVerification";
import { getPlanAmountRial, isBitpayPlanKey } from "@/lib/payments/plans";
import { getBitpayPublicOrigin, pricingUrl } from "@/lib/payments/publicOrigin";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const plan = url.searchParams.get("plan") ?? "";
  const locale = url.searchParams.get("locale") ?? "fa";
  const origin = getBitpayPublicOrigin(req);

  if (!isBitpayPlanKey(plan)) {
    return NextResponse.redirect(
      pricingUrl(locale, origin, new URLSearchParams({ payment: "invalid_plan" })),
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const signIn = new URL(
      locale === "fa" ? "/sign-in" : `/${locale}/sign-in`,
      origin,
    );
    signIn.searchParams.set("next", `${url.pathname}${url.search}`);
    return NextResponse.redirect(signIn);
  }

  const rawCode = url.searchParams.get("code")?.trim() ?? "";
  const listAmountRial = getPlanAmountRial(plan);
  let amountRial = listAmountRial;
  let discountAmountRial = 0;
  let discount: { codeId: string; code: string } | null = null;

  if (rawCode) {
    let evaluation;
    try {
      evaluation = await evaluateDiscountCode({
        rawCode,
        plan,
        userId: user.id,
      });
    } catch (error) {
      console.error("[discount] checkout evaluation failed", error);
      return NextResponse.redirect(
        pricingUrl(locale, origin, new URLSearchParams({ payment: "code_error" })),
      );
    }
    if (!evaluation.ok) {
      return NextResponse.redirect(
        pricingUrl(
          locale,
          origin,
          new URLSearchParams({
            payment: "code_invalid",
            reason: evaluation.reason,
            code: rawCode.toUpperCase().slice(0, 32),
          }),
        ),
      );
    }

    if (evaluation.amount.amountRial === 0) {
      // 100% code: activate without the gateway, under a lock on the code.
      try {
        const free = await redeemFreeDiscount({ rawCode, plan, userId: user.id });
        if (!free.ok) {
          return NextResponse.redirect(
            pricingUrl(
              locale,
              origin,
              new URLSearchParams({
                payment: "code_invalid",
                reason: free.reason === "not_free" ? "not_found" : free.reason,
                code: rawCode.toUpperCase().slice(0, 32),
              }),
            ),
          );
        }
        return NextResponse.redirect(
          pricingUrl(
            locale,
            origin,
            new URLSearchParams({ payment: "success", plan, free: "1" }),
          ),
        );
      } catch (error) {
        console.error("[discount] free redemption failed", error);
        return NextResponse.redirect(
          pricingUrl(locale, origin, new URLSearchParams({ payment: "code_error" })),
        );
      }
    }

    amountRial = evaluation.amount.amountRial;
    discountAmountRial = evaluation.amount.discountAmountRial;
    discount = { codeId: evaluation.code.id, code: evaluation.code.code };
  }

  let order: PaymentOrder | null = null;
  try {
    order = await createPendingBitpayOrder({
      userId: user.id,
      planKey: plan,
      listAmountRial,
      discountAmountRial,
      amountRial,
      discount,
    });
  } catch (error) {
    if (!isMissingOrdersTableError(error)) {
      console.error("[bitpay] could not create payment order", error);
      return NextResponse.redirect(
        pricingUrl(locale, origin, new URLSearchParams({ payment: "gateway_error" })),
      );
    }
    if (discount) {
      // A discounted price cannot go through the legacy flow: its callback
      // expects the full plan price.
      return NextResponse.redirect(
        pricingUrl(locale, origin, new URLSearchParams({ payment: "code_error" })),
      );
    }
    // payment_orders migration not applied yet: legacy plan-based state.
    // The callback still checks BitPay's echoed amount against the plan.
    console.warn("[bitpay] payment_orders table missing; using legacy checkout");
  }

  const state = createCheckoutState({
    userId: user.id,
    plan,
    locale,
    ...(order ? { orderId: order.id } : {}),
  });

  const callbackUrl = new URL("/api/payments/bitpay/callback", origin);
  callbackUrl.searchParams.set("state", state);

  try {
    const result = await createBitpayPayment({
      amount: order?.amountRial ?? listAmountRial,
      redirect: callbackUrl.toString(),
      description: `Lenra ${plan} subscription`,
      factorId: order?.factorId ?? newFactorId(),
    });

    if (!result.ok) {
      if (order) await markOrderFailed(order.id, result.code).catch(() => {});
      return NextResponse.redirect(
        pricingUrl(
          locale,
          origin,
          new URLSearchParams({
            payment: "start_failed",
            code: String(result.code),
          }),
        ),
      );
    }

    if (order) await setOrderGatewayId(order.id, result.getId);
    return NextResponse.redirect(result.paymentUrl);
  } catch (error) {
    if (order) await markOrderFailed(order.id, null).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    const params = new URLSearchParams({ payment: "gateway_error" });
    if (message.includes("BITPAY_API is not set")) {
      params.set("payment", "missing_api");
    }
    return NextResponse.redirect(pricingUrl(locale, origin, params));
  }
}
