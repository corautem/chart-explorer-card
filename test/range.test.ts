import { describe, expect, it } from 'vitest';
import { addMonthsClamped, parseQuickRange, rollingStart, sameLength } from '../src/time/duration';
import {
  sortRangeItems,
  parseRangeItem,
  rangeItemId,
  nowSpec,
  parseRangeSpec,
  presetOf,
  presetSpec,
  resolveWindow,
  startOfUnit,
  stepSpec,
  type RangeSpec,
} from '../src/time/range';
import { localeWeekStart, resolveWeekStart } from '../src/time/week';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 3_600_000;
const MONDAY = 1;
const SUNDAY = 0;
const SATURDAY = 6;

describe('quick ranges', () => {
  it('parses lengths and rejects junk', () => {
    expect(parseQuickRange('24h')).toEqual({ id: '24h', amount: 24, unit: 'h' });
    expect(parseQuickRange('3mo')).toEqual({ id: '3mo', amount: 3, unit: 'mo' });
    expect(parseQuickRange(' 1y ')).toEqual({ id: '1y', amount: 1, unit: 'y' });
    expect(parseQuickRange('0h')).toBeUndefined();
    expect(parseQuickRange('h')).toBeUndefined();
    expect(parseQuickRange('5x')).toBeUndefined();
  });

  it('reads lengths that run into the future', () => {
    expect(parseQuickRange('+6h')).toEqual({ id: '+6h', amount: 6, unit: 'h', forward: true });
    expect(sameLength(parseQuickRange('+1d')!, parseQuickRange('24h')!)).toBe(false);
  });

  it('treats 24h and 1d as the same length', () => {
    expect(sameLength(parseQuickRange('24h')!, parseQuickRange('1d')!)).toBe(true);
    expect(sameLength(parseQuickRange('12mo')!, parseQuickRange('1y')!)).toBe(true);
    expect(sameLength(parseQuickRange('7d')!, parseQuickRange('1y')!)).toBe(false);
  });

  it('steps months by the calendar, clamping the day', () => {
    expect(addMonthsClamped(local(2026, 3, 31, 10), -1)).toBe(local(2026, 2, 28, 10));
    expect(addMonthsClamped(local(2024, 2, 29, 8), -12)).toBe(local(2023, 2, 28, 8));
    expect(rollingStart(local(2026, 10, 30, 10), parseQuickRange('1y')!)).toBe(local(2025, 10, 30, 10));
  });

  it('rolling hour and day ranges are exact durations', () => {
    const end = local(2026, 10, 30, 12);
    expect(end - rollingStart(end, parseQuickRange('6h')!)).toBe(6 * HOUR);
    expect(end - rollingStart(end, parseQuickRange('7d')!)).toBe(7 * 24 * HOUR);
  });
});

describe('presets', () => {
  const now = local(2026, 10, 30, 14, 25); // a Friday

  it('today, yesterday and tomorrow are whole local days', () => {
    expect(resolveWindow(presetSpec('today'), now, MONDAY)).toEqual({ start: local(2026, 10, 30), end: local(2026, 10, 31) });
    expect(resolveWindow(presetSpec('yesterday'), now, MONDAY)).toEqual({ start: local(2026, 10, 29), end: local(2026, 10, 30) });
    expect(resolveWindow(presetSpec('tomorrow'), now, MONDAY)).toEqual({ start: local(2026, 10, 31), end: local(2026, 11, 1) });
  });

  it('weeks follow the first day of the week', () => {
    expect(resolveWindow(presetSpec('this_week'), now, MONDAY).start).toBe(local(2026, 10, 26));
    expect(resolveWindow(presetSpec('this_week'), now, SUNDAY).start).toBe(local(2026, 10, 25));
    expect(resolveWindow(presetSpec('this_week'), now, SATURDAY).start).toBe(local(2026, 10, 24));
    expect(resolveWindow(presetSpec('last_week'), now, MONDAY)).toEqual({ start: local(2026, 10, 19), end: local(2026, 10, 26) });
  });

  it('a week starting on the same weekday as today starts today', () => {
    expect(startOfUnit(now, 'week', 5)).toBe(local(2026, 10, 30));
  });

  it('months and years', () => {
    expect(resolveWindow(presetSpec('this_month'), now, MONDAY)).toEqual({ start: local(2026, 10, 1), end: local(2026, 11, 1) });
    expect(resolveWindow(presetSpec('last_month'), now, MONDAY)).toEqual({ start: local(2026, 9, 1), end: local(2026, 10, 1) });
    expect(resolveWindow(presetSpec('this_year'), now, MONDAY)).toEqual({ start: local(2026, 1, 1), end: local(2027, 1, 1) });
    expect(resolveWindow(presetSpec('last_year'), now, MONDAY)).toEqual({ start: local(2025, 1, 1), end: local(2026, 1, 1) });
  });

  it('days on clock-change dates still run midnight to midnight', () => {
    // The last Sundays of March and October 2026 are clock-change days in Europe.
    for (const day of [local(2026, 3, 29, 12), local(2026, 10, 25, 12)]) {
      const w = resolveWindow(presetSpec('today'), day, MONDAY);
      expect(new Date(w.start).getHours()).toBe(0);
      expect(new Date(w.end).getHours()).toBe(0);
      expect(new Date(w.end).getDate()).toBe(new Date(day).getDate() + 1);
    }
  });

  it('maps calendar specs back to preset ids', () => {
    expect(presetOf(presetSpec('last_month'))).toBe('last_month');
    expect(presetOf({ kind: 'calendar', unit: 'week', offset: -2 })).toBeUndefined();
    expect(parseRangeSpec('this_week')).toEqual(presetSpec('this_week'));
    expect(parseRangeSpec('12h')).toEqual({ kind: 'rolling', quick: parseQuickRange('12h') });
    expect(parseRangeSpec('nonsense')).toBeUndefined();
  });
});

describe('stepping', () => {
  const now = local(2026, 10, 30, 14, 25);

  it('calendar windows step by calendar period', () => {
    const back = stepSpec(presetSpec('this_month'), -1, now, MONDAY);
    expect(resolveWindow(back, now, MONDAY)).toEqual({ start: local(2026, 9, 1), end: local(2026, 10, 1) });
    const twoBack = stepSpec(back, -1, now, MONDAY);
    expect(resolveWindow(twoBack, now, MONDAY)).toEqual({ start: local(2026, 8, 1), end: local(2026, 9, 1) });
    expect(presetOf(stepSpec(presetSpec('today'), 1, now, MONDAY))).toBe('tomorrow');
  });

  it('rolling windows step by their length and return live on the way back', () => {
    const live: RangeSpec = { kind: 'rolling', quick: parseQuickRange('24h')! };
    const back = stepSpec(live, -1, now, MONDAY);
    expect(back.kind).toBe('fixed');
    expect(resolveWindow(back, now, MONDAY)).toEqual({ start: now - 48 * HOUR, end: now - 24 * HOUR });
    const later = now + 5 * 60_000;
    expect(stepSpec(back, 1, later, MONDAY)).toEqual(live);
  });

  it('two steps back need two steps forward', () => {
    const live: RangeSpec = { kind: 'rolling', quick: parseQuickRange('6h')! };
    const twoBack = stepSpec(stepSpec(live, -1, now, MONDAY), -1, now, MONDAY);
    const oneBack = stepSpec(twoBack, 1, now, MONDAY);
    expect(oneBack.kind).toBe('fixed');
    expect(stepSpec(oneBack, 1, now, MONDAY)).toEqual(live);
  });

  it('forward from a live window goes into the future', () => {
    const live: RangeSpec = { kind: 'rolling', quick: parseQuickRange('6h')! };
    const ahead = stepSpec(live, 1, now, MONDAY);
    expect(resolveWindow(ahead, now, MONDAY)).toEqual({ start: now, end: now + 6 * HOUR });
    expect(stepSpec(ahead, -1, now, MONDAY)).toEqual(live);
  });

  it('next windows start now, and stepping back and forth returns to them', () => {
    const next: RangeSpec = { kind: 'rolling', quick: parseQuickRange('+1d')! };
    expect(resolveWindow(next, now, MONDAY)).toEqual({ start: now, end: now + 24 * HOUR });
    const back = stepSpec(next, -1, now, MONDAY);
    expect(resolveWindow(back, now, MONDAY)).toEqual({ start: now - 24 * HOUR, end: now });
    expect(stepSpec(back, 1, now + 60_000, MONDAY)).toEqual(next);
  });

  it('zoomed windows step by their own length', () => {
    const zoomed: RangeSpec = { kind: 'fixed', start: local(2026, 10, 3, 6), end: local(2026, 10, 3, 9) };
    expect(stepSpec(zoomed, -1, now, MONDAY)).toEqual({
      kind: 'fixed',
      start: local(2026, 10, 3, 3),
      end: local(2026, 10, 3, 6),
      rolling: undefined,
    });
  });

  it('Now brings each kind of window to the present', () => {
    expect(nowSpec({ kind: 'calendar', unit: 'week', offset: -3 })).toEqual(presetSpec('this_week'));
    const quick = parseQuickRange('12h')!;
    expect(nowSpec({ kind: 'fixed', start: 0, end: 1, rolling: quick })).toEqual({ kind: 'rolling', quick });
    expect(nowSpec({ kind: 'fixed', start: 0, end: 90 * 60_000 })).toEqual({
      kind: 'rolling',
      quick: { id: '90m', amount: 90, unit: 'm' },
    });
    expect(nowSpec({ kind: 'fixed', start: 0, end: 3 * HOUR })).toEqual({
      kind: 'rolling',
      quick: { id: '3h', amount: 3, unit: 'h' },
    });
  });
});

describe('first day of the week', () => {
  it('uses the profile setting when it names a day', () => {
    expect(resolveWeekStart('sunday', 'en-GB')).toBe(SUNDAY);
    expect(resolveWeekStart('saturday', 'en-GB')).toBe(SATURDAY);
    expect(resolveWeekStart('monday', 'en-US')).toBe(MONDAY);
  });

  it('"language" follows the browser locale', () => {
    expect(resolveWeekStart('language', 'en-GB')).toBe(MONDAY);
    expect(resolveWeekStart('language', 'en-US')).toBe(SUNDAY);
    expect(resolveWeekStart(undefined, 'de-DE')).toBe(MONDAY);
    expect(localeWeekStart('ar-EG')).toBe(SATURDAY);
  });

  it('falls back to Monday for an invalid language tag', () => {
    expect(localeWeekStart('not a tag!')).toBe(MONDAY);
  });
});

describe('range lists', () => {
  it('sort past lengths first, then next lengths, then presets', () => {
    const ids = ['today', '+1d', '6h', '+6h', '1h'].map((id) => parseRangeItem(id)!);
    expect(sortRangeItems(ids).map(rangeItemId)).toEqual(['1h', '6h', '+6h', '+1d', 'today']);
  });
});
