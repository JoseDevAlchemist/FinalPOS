import "server-only";

export function isCardPaymentConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY?.trim() && process.env.FLW_SECRET_KEY?.trim());
}
