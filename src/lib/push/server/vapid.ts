
export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:support@lenra.ir";

  if (!publicKey || !privateKey) return null;

  return { publicKey, privateKey, subject };
}

export function isWebPushConfigured(): boolean {
  return getVapidConfig() != null;
}
