const BITPAY_GATEWAY_SEND_URL = "https://bitpay.ir/payment/gateway-send";
const BITPAY_GATEWAY_RESULT_URL =
  "https://bitpay.ir/payment/gateway-result-second";

export interface BitpayStartRequest {
  amount: number;
  redirect: string;
  name?: string;
  email?: string;
  description?: string;
  factorId?: number;
  mobileNum?: string;
  cardNum?: string;
}

export interface BitpayStartResult {
  ok: true;
  getId: number;
  paymentUrl: string;
}

export interface BitpayStartError {
  ok: false;
  code: number;
  message: string;
}

export interface BitpayVerifyRequest {
  idTrans: number;
  getId: number;
}

export interface BitpayVerifyResult {
  status: number;
  id_trans?: number;
  get_id?: number;
  amount?: number;
  cardNum?: string;
  factorId?: string;
}

function requireBitpayApi(): string {
  const api = process.env.BITPAY_API?.trim();
  if (!api) {
    throw new Error("BITPAY_API is not set");
  }
  return api;
}

/** BitPay `gateway-result-second` verify statuses (not the same as gateway-send errors). */
function mapVerifyError(code: number): string {
  switch (code) {
    case -1:
      return "Invalid API key for BitPay verify";
    case -2:
      return "trans_id is missing or not numeric in verify request";
    case -3:
      return "id_get is missing or not numeric in verify request";
    case -4:
      return "Transaction not found or was not successful";
    case 11:
      return "Transaction was already verified";
    default:
      return "Unknown BitPay verify error";
  }
}

function mapStartError(code: number): string {
  switch (code) {
    case -1:
      return "Invalid API value";
    case -2:
      return "Invalid amount (must be integer >= 5000)";
    case -3:
      return "Invalid redirect URL";
    case -4:
      return "Gateway is not active or request origin mismatch";
    case -5:
      return "BitPay gateway connection error";
    default:
      return "Unknown BitPay error";
  }
}

export async function createBitpayPayment(
  req: BitpayStartRequest,
): Promise<BitpayStartResult | BitpayStartError> {
  const body = new URLSearchParams();
  body.set("api", requireBitpayApi());
  body.set("amount", String(req.amount));
  body.set("redirect", req.redirect);

  if (req.name) body.set("name", req.name);
  if (req.email) body.set("email", req.email);
  if (req.description) body.set("description", req.description);
  if (typeof req.factorId === "number" && Number.isInteger(req.factorId)) {
    body.set("factorId", String(req.factorId));
  }
  if (req.mobileNum) body.set("mobileNum", req.mobileNum);
  if (req.cardNum) body.set("cardNum", req.cardNum);

  const response = await fetch(BITPAY_GATEWAY_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const raw = (await response.text()).trim();
  const code = Number(raw);

  if (!Number.isFinite(code)) {
    throw new Error(`Unexpected BitPay response: ${raw.slice(0, 200)}`);
  }

  if (code <= 0) {
    return {
      ok: false,
      code,
      message: mapStartError(code),
    };
  }

  return {
    ok: true,
    getId: code,
    paymentUrl: `https://bitpay.ir/payment/gateway-${code}-get`,
  };
}

export async function verifyBitpayPayment(
  req: BitpayVerifyRequest,
): Promise<BitpayVerifyResult> {
  const body = new URLSearchParams();
  body.set("api", requireBitpayApi());
  /** BitPay docs / reference drivers use `trans_id` + `id_get`, not `id_trans` / `get_id`. */
  body.set("trans_id", String(req.idTrans));
  body.set("id_get", String(req.getId));
  body.set("json", "1");

  const response = await fetch(BITPAY_GATEWAY_RESULT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid BitPay verify response: ${raw.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid BitPay verify response format");
  }

  const result = parsed as BitpayVerifyResult;
  if (
    typeof result.status === "number" &&
    result.status <= 0 &&
    result.status !== 11
  ) {
    console.warn(
      "[bitpay] verify failed:",
      result.status,
      mapVerifyError(result.status),
    );
  }
  return result;
}

export { mapVerifyError };
