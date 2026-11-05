import type { DataSettings } from '../config';
import { DAY, HOUR, MINUTE } from '../time/duration';
import type { TimeWindow } from '../time/range';
import type { Resolution } from './types';

export const PERIOD_MS: Record<Exclude<Resolution, 'raw'>, number> = {
  '5minute': 5 * MINUTE,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
};

/**
 * Picks the data for a window: raw history for short windows, then 5-minute,
 * hourly, daily and weekly statistics as windows get longer. Raw history and
 * 5-minute statistics reach back only as far as the recorder keeps them;
 * `rawSince` is that point once the card has learned it from replies. Only
 * the part up to `now` has history, so a window running into the future is
 * judged by that part (12 hours back and 48 ahead is 12 hours of history).
 */
export function chooseResolution(window: TimeWindow, s: DataSettings, rawSince?: number, now = Infinity): Resolution {
  if (s.source === 'history') return 'raw';
  const length = Math.max(0, Math.min(window.end, now) - window.start);
  const recent = rawSince === undefined || window.start >= rawSince;
  // One hour of slack so a 25-hour day at a clock change still counts as a day.
  if (s.source === 'auto' && recent && length <= s.rawMaxHours * HOUR + HOUR) return 'raw';
  if (recent && length <= s.fiveMinuteMaxDays * DAY) return '5minute';
  if (length <= s.hourlyMaxDays * DAY) return 'hour';
  if (length <= 3 * 366 * DAY) return 'day';
  return 'week';
}
