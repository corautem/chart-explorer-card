import { describe, expect, it } from 'vitest';
import {
  TimeFormatter,
  csvTime,
  fileStamp,
  fromDatetimeLocal,
  isLocalMidnight,
  toDatetimeLocal,
} from '../src/time/format';
import { exportFileName } from '../src/export/filename';
import { NumberFormatter, decimalsOf, stateToNumber } from '../src/number';

const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s).getTime();
const now = local(2026, 10, 30, 14, 25);

describe('range label', () => {
  const fmt = new TimeFormatter('en-GB', '24');

  it('matches the agreed format for a calendar week', () => {
    const w = { start: local(2026, 10, 26), end: local(2026, 11, 2) };
    expect(fmt.rangeLabel(w, true, now)).toBe('Mon 26 Oct 00:00 - Sun 1 Nov 23:59');
  });

  it('drops the repeated date within one day', () => {
    const w = { start: local(2026, 10, 30, 8), end: local(2026, 10, 30, 14) };
    expect(fmt.rangeLabel(w, false, now)).toBe('Fri 30 Oct 08:00 - 14:00');
  });

  it('adds the year when it is not this year', () => {
    const w = { start: local(2025, 1, 1), end: local(2026, 1, 1) };
    // British English adds a comma after the weekday when the year is shown.
    expect(fmt.rangeLabel(w, true, now)).toMatch(/^Wed,? 1 Jan 2025 00:00 - Wed,? 31 Dec 2025 23:59$/);
  });

  it('follows a 12-hour setting', () => {
    const twelve = new TimeFormatter('en-GB', '12');
    const w = { start: local(2026, 10, 30, 13), end: local(2026, 10, 30, 15) };
    expect(twelve.rangeLabel(w, false, now)).toMatch(/^Fri 30 Oct 01:00\s?pm - 03:00\s?pm$/i);
  });

  it('labels midnight ticks with dates and others with times', () => {
    const day = 24 * 3_600_000;
    expect(fmt.axisLabel(local(2026, 10, 30, 6), day)).toBe('06:00');
    expect(fmt.axisLabel(local(2026, 10, 30), day)).toBe('Fri 30');
    expect(fmt.axisLabel(local(2026, 10, 30), 30 * day)).toBe('30 Oct');
    expect(fmt.axisLabel(local(2026, 11, 1), 365 * day)).toBe('Nov');
    expect(fmt.axisLabel(local(2027, 1, 1), 365 * day)).toBe('2027');
  });
});

describe('machine formats', () => {
  it('CSV times are local YYYY-MM-DD HH:mm:ss', () => {
    expect(csvTime(local(2026, 3, 5, 7, 8, 9))).toBe('2026-03-05 07:08:09');
  });

  it('file stamps', () => {
    expect(fileStamp(local(2026, 10, 30, 9, 5), false)).toBe('2026-10-30');
    expect(fileStamp(local(2026, 10, 30, 9, 5), true)).toBe('2026-10-30_0905');
  });

  it('datetime-local values round-trip', () => {
    const t = local(2026, 10, 30, 23, 45);
    expect(toDatetimeLocal(t)).toBe('2026-10-30T23:45');
    expect(fromDatetimeLocal('2026-10-30T23:45')).toBe(t);
    expect(fromDatetimeLocal('garbage')).toBeUndefined();
  });

  it('detects local midnight', () => {
    expect(isLocalMidnight(local(2026, 10, 30))).toBe(true);
    expect(isLocalMidnight(local(2026, 10, 30, 0, 1))).toBe(false);
  });
});

describe('export file names', () => {
  it('whole days use dates, with the last day as the end', () => {
    const w = { start: local(2026, 10, 26), end: local(2026, 11, 2) };
    expect(exportFileName('Heating', w, 'csv')).toBe('Heating_2026-10-26_2026-11-01.csv');
  });

  it('other windows add the time, and "chart" stands in for a missing title', () => {
    const w = { start: local(2026, 10, 30, 8), end: local(2026, 10, 30, 14, 30) };
    expect(exportFileName(undefined, w, 'png')).toBe('chart_2026-10-30_0800_2026-10-30_1430.png');
  });

  it('replaces characters that file systems reject', () => {
    const w = { start: local(2026, 10, 26), end: local(2026, 10, 27) };
    expect(exportFileName('Flow/Return: "a"?', w, 'csv')).toBe('Flow-Return- -a-_2026-10-26_2026-10-26.csv');
  });
});

describe('numbers', () => {
  it('formats with the profile number format', () => {
    expect(new NumberFormatter({ language: 'en-GB' }).format(1234.5, 1)).toBe('1,234.5');
    expect(new NumberFormatter({ language: 'en-GB', number_format: 'decimal_comma' }).format(1234.5, 1)).toBe('1.234,5');
    expect(new NumberFormatter({ language: 'en-GB', number_format: 'none' }).format(1234.5, 1)).toBe('1234.5');
  });

  it('keeps the decimals written in the state', () => {
    expect(decimalsOf('21.50')).toBe(2);
    expect(decimalsOf('7')).toBe(0);
    expect(decimalsOf('on')).toBeUndefined();
  });

  it('turns text states into gaps', () => {
    expect(stateToNumber('21.5')).toBe(21.5);
    expect(stateToNumber('unavailable')).toBeNaN();
    expect(stateToNumber('')).toBeNaN();
    expect(stateToNumber(undefined)).toBeNaN();
  });
});
