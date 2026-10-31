export type DurationUnit = 'm' | 'h' | 'd' | 'w' | 'mo' | 'y';

/**
 * A rolling window length such as `24h`, written the way the config writes it.
 * `forward` windows start now and run into the future (`+24h`), for forecasts.
 */
export interface QuickRange {
  id: string;
  amount: number;
  unit: DurationUnit;
  forward?: boolean;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const FIXED_MS: Record<'m' | 'h' | 'd' | 'w', number> = {
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: 7 * DAY,
};

export function parseQuickRange(text: string): QuickRange | undefined {
  const match = /^\s*(\+)?\s*(\d+)\s*(mo|m|h|d|w|y)\s*$/.exec(text);
  if (!match) return undefined;
  const amount = Number(match[2]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  const unit = match[3] as DurationUnit;
  return match[1] ? { id: `+${amount}${unit}`, amount, unit, forward: true } : { id: `${amount}${unit}`, amount, unit };
}

/** Builds the shortest exact quick range for a whole number of minutes. */
export function quickFromMinutes(minutes: number): QuickRange {
  if (minutes % (24 * 60) === 0) return quick(minutes / (24 * 60), 'd');
  if (minutes % 60 === 0) return quick(minutes / 60, 'h');
  return quick(minutes, 'm');
}

function quick(amount: number, unit: DurationUnit): QuickRange {
  return { id: `${amount}${unit}`, amount, unit };
}

/**
 * Moves a date by whole months, keeping the time of day and clamping the day
 * to the target month's length (31 March minus one month is 28 or 29 February).
 */
export function addMonthsClamped(ms: number, months: number): number {
  const date = new Date(ms);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date.getTime();
}

/** Start of a rolling window ending at `end`. Months and years step by the calendar. */
export function rollingStart(end: number, range: QuickRange): number {
  if (range.unit === 'mo') return addMonthsClamped(end, -range.amount);
  if (range.unit === 'y') return addMonthsClamped(end, -12 * range.amount);
  return end - range.amount * FIXED_MS[range.unit];
}

/** End of a forward window starting at `start`. Months and years step by the calendar. */
export function rollingEnd(start: number, range: QuickRange): number {
  if (range.unit === 'mo') return addMonthsClamped(start, range.amount);
  if (range.unit === 'y') return addMonthsClamped(start, 12 * range.amount);
  return start + range.amount * FIXED_MS[range.unit];
}

/** Exact length in milliseconds for minutes to weeks; months and years vary. */
export function fixedLengthMs(range: QuickRange): number | undefined {
  return range.unit === 'mo' || range.unit === 'y' ? undefined : range.amount * FIXED_MS[range.unit];
}

/** Rough length for sorting: months as 30.44 days, years as 365.25 days. */
export function approximateMs(range: QuickRange): number {
  if (range.unit === 'mo') return range.amount * 30.44 * DAY;
  if (range.unit === 'y') return range.amount * 365.25 * DAY;
  return range.amount * FIXED_MS[range.unit];
}

/** True when two quick ranges describe the same length (24h and 1d match). */
export function sameLength(a: QuickRange, b: QuickRange): boolean {
  return Boolean(a.forward) === Boolean(b.forward) && lengthKey(a) === lengthKey(b);
}

function lengthKey(range: QuickRange): string {
  if (range.unit === 'mo') return `mo${range.amount}`;
  if (range.unit === 'y') return `mo${range.amount * 12}`;
  return `ms${range.amount * FIXED_MS[range.unit]}`;
}
