import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { createBitpayPayment } from "@/lib/payments/bitpay";
import { createCheckoutState } from "@/lib/payments/checkoutState";
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

  const state = createCheckoutState({
    userId: user.id,
    plan,
    locale,
  });

  const callbackUrl = new URL("/api/payments/bitpay/callback", origin);
  callbackUrl.searchParams.set("state", state);

  try {
    const result = await createBitpayPayment({
      amount: getPlanAmountRial(plan),
      redirect: callbackUrl.toString(),
      description: `Lenra ${plan} subscription`,
      factorId: Date.now(),
    });

    if (!result.ok) {
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

    return NextResponse.redirect(result.paymentUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const params = new URLSearchParams({ payment: "gateway_error" });
    if (message.includes("BITPAY_API is not set")) {
      params.set("payment", "missing_api");
    }
    return NextResponse.redirect(pricingUrl(locale, origin, params));
  }
}
