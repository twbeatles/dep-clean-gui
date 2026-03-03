export type SupportedLocale = 'en' | 'ko';

export function normalizeSupportedLocale(input: string | null | undefined): SupportedLocale {
  const normalized = (input ?? '').toLowerCase();
  if (normalized.startsWith('ko')) return 'ko';
  return 'en';
}
