export const PIN_LENGTH = 4;

export function normalizePin(input: string): string {
  return input.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

export function isCompletePin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
