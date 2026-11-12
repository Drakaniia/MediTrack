export function isIsoDate(value: unknown): value is string;
export function addDays(iso: string, days: number): string;
export function daysBetween(fromIso: string, toIso: string): number;
export function todayInZone(now: Date, timeZone: string): string;
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string
): Date;
export function resolveRelativeMoment(
  spec: string,
  today: string,
  timeZone: string
): { date: string; iso: string; offset: number };
