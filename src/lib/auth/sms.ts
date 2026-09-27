/**
 * Kavenegar OTP (Lookup / verification) sender.
 *
 * Backends:
 *  - Production — when KAVENEGAR_API_KEY and KAVENEGAR_OTP_TEMPLATE are set.
 *    POST https://api.kavenegar.com/v1/{key}/verify/lookup.json
 *    (`template` = panel verification template name, e.g. lenra-otp with %token%)
 *  - Dev fallback — logs to stdout and returns devEcho when the API key is unset.
 *  - Trial / test — KAVENEGAR_TEST_MODE=true: on error 501 (trial account may only
 *    SMS the phone registered on the Kavenegar panel), fall back to devEcho so
 *    sign-in still works locally; use your panel phone to receive a real SMS.
 *
 * The OTP module stores phones in E.164 (+989...). Kavenegar expects receptor as
 * Iranian local format (09xxxxxxxxx); we convert in `toIranLocalPhone`.
 */
export interface OtpLookupRequest {
  to: string;
  token: string;
}

export type SmsResult =
  | { ok: true; devEcho: boolean }
  | { ok: false; error: string };

/** Convert "+989308876486" / "989308876486" / "9308876486" to "09308876486". */
export function toIranLocalPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("98") && digits.length === 12) return "0" + digits.slice(2);
  if (digits.startsWith("0098")) return "0" + digits.slice(4);
  if (digits.startsWith("9") && digits.length === 10) return "0" + digits;
  if (digits.startsWith("09") && digits.length === 11) return digits;
  return digits;
}

function isKavenegarTestMode(): boolean {
  const v = process.env.KAVENEGAR_TEST_MODE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

interface KavenegarReturn {
  status: number;
  message: string;
}

interface KavenegarResponse {
  return: KavenegarReturn;
  entries?: Record<string, string | number | boolean | null>;
}

export async function sendOtpLookup(req: OtpLookupRequest): Promise<SmsResult> {
  const apiKey = process.env.KAVENEGAR_API_KEY;
  if (!apiKey) {
    console.warn(
      `[sms:dev] KAVENEGAR_API_KEY is not set — would send OTP to ${req.to}: token="${req.token}"`
    );
    return { ok: true, devEcho: true };
  }

  const template = process.env.KAVENEGAR_OTP_TEMPLATE?.trim();
  if (!template) {
    return {
      ok: false,
      error: "KAVENEGAR_OTP_TEMPLATE is not set (verification template name from Kavenegar panel)",
    };
  }

  const receptor = toIranLocalPhone(req.to);
  const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`;
  const body = new URLSearchParams({
    receptor,
    token: req.token,
    template,
    type: "sms",
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
    });

    const text = await res.text();
    let parsed: KavenegarResponse | null = null;
    try {
      parsed = JSON.parse(text) as KavenegarResponse;
    } catch {
      return {
        ok: false,
        error: `Kavenegar HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    if (parsed?.return?.status === 200) {
      return { ok: true, devEcho: false };
    }

    const message = parsed?.return?.message || `HTTP ${res.status}`;
    const code = parsed?.return?.status ?? res.status;

    if (isKavenegarTestMode() && code === 501) {
      console.warn(
        `[sms:test] Kavenegar ${code} (${message}) — trial accounts only SMS the phone on your panel. Dev echo to ${receptor}: token="${req.token}"`
      );
      return { ok: true, devEcho: true };
    }

    return { ok: false, error: `Kavenegar error ${code}: ${message}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Kavenegar fetch failed: ${message}` };
  }
}
