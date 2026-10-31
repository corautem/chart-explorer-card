import type { TimeFormat } from '../ha-types';
import { DAY, HOUR } from './duration';
import type { TimeWindow } from './range';

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function supportedLanguage(language: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(language)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

function hourCycle(timeFormat: TimeFormat | undefined): Intl.DateTimeFormatOptions {
  if (timeFormat === '12') return { hourCycle: 'h12' };
  if (timeFormat === '24') return { hourCycle: 'h23' };
  if (timeFormat === 'system') {
    const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
    return hour12 === undefined ? {} : { hourCycle: hour12 ? 'h12' : 'h23' };
  }
  return {};
}

/** Hours and minutes: "8:05 PM" on a 12-hour clock, "08:05" on a 24-hour one. */
function clockFormat(lang: string, cycle: Intl.DateTimeFormatOptions, seconds: boolean): Intl.DateTimeFormat {
  const extra: Intl.DateTimeFormatOptions = seconds ? { second: '2-digit' } : {};
  const padded = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', ...extra, ...cycle });
  const twelve = ['h11', 'h12'].includes(padded.resolvedOptions().hourCycle ?? '');
  return twelve ? new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', ...extra, ...cycle }) : padded;
}

/** Weekday and day of the month, such as "Tue 27". English would otherwise put the day first ("27 Tue"). */
function weekdayDayFormat(lang: string): (date: Date) => string {
  const format = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric' });
  if (!lang.toLowerCase().startsWith('en')) return (date) => format.format(date);
  return (date) => {
    const parts = format.formatToParts(date);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return weekday && day ? `${weekday} ${day}` : format.format(date);
  };
}

/** Labels for the toolbar, the time axis and the cursor, in the device's local time. */
export class TimeFormatter {
  private readonly weekdayDate: Intl.DateTimeFormat;
  private readonly weekdayDateYear: Intl.DateTimeFormat;
  private readonly time: Intl.DateTimeFormat;
  private readonly timeSeconds: Intl.DateTimeFormat;
  private readonly dayMonth: Intl.DateTimeFormat;
  private readonly dayMonthYear: Intl.DateTimeFormat;
  private readonly weekdayDay: (date: Date) => string;
  private readonly month: Intl.DateTimeFormat;
  private readonly year: Intl.DateTimeFormat;

  constructor(language: string, timeFormat?: TimeFormat) {
    const lang = supportedLanguage(language);
    const cycle = hourCycle(timeFormat);
    this.weekdayDate = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' });
    this.weekdayDateYear = new Intl.DateTimeFormat(lang, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    this.time = clockFormat(lang, cycle, false);
    this.timeSeconds = clockFormat(lang, cycle, true);
    this.dayMonth = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
    this.dayMonthYear = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    this.weekdayDay = weekdayDayFormat(lang);
    this.month = new Intl.DateTimeFormat(lang, { month: 'short' });
    this.year = new Intl.DateTimeFormat(lang, { year: 'numeric' });
  }

  /** "Mon 27 Oct 00:00 - Sun 2 Nov 23:59"; the year appears only when it is not this year. */
  rangeLabel(window: TimeWindow, inclusiveEnd: boolean, now: number): string {
    const [start, end] = this.rangeParts(window, inclusiveEnd, now);
    return `${start} - ${end}`;
  }

  /** The label's start and end, for showing on two lines; the end drops a repeated date. */
  rangeParts(window: TimeWindow, inclusiveEnd: boolean, now: number): [string, string] {
    const start = new Date(window.start);
    const end = new Date(inclusiveEnd ? window.end - 60_000 : window.end);
    const thisYear = new Date(now).getFullYear();
    const startText = `${this.datePart(start, thisYear)} ${this.time.format(start)}`;
    if (start.toDateString() === end.toDateString()) return [startText, this.time.format(end)];
    return [startText, `${this.datePart(end, thisYear)} ${this.time.format(end)}`];
  }

  /** Time shown on the x-axis under the cursor line. */
  cursorLabel(ms: number, windowLength: number, dateOnly: boolean): string {
    const date = new Date(ms);
    const thisYear = new Date().getFullYear();
    if (dateOnly) return this.datePart(date, thisYear);
    const time = windowLength <= 2 * HOUR ? this.timeSeconds.format(date) : this.time.format(date);
    return `${this.datePart(date, thisYear)} ${time}`;
  }

  /** An hour of the day, such as "06:00" or "6:00 AM", for the heatmap's scale. */
  hourLabel(hour: number): string {
    return this.time.format(new Date(2026, 0, 1, hour, 0, 0));
  }

  /** Tick labels: times within a day, dates at midnight, months and years on long windows. */
  axisLabel(ms: number, windowLength: number): string {
    const date = new Date(ms);
    const midnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
    if (!midnight) return this.time.format(date);
    const longWindow = windowLength > 45 * DAY;
    if (longWindow && date.getDate() === 1) {
      return date.getMonth() === 0 ? this.year.format(date) : this.month.format(date);
    }
    if (windowLength > 400 * DAY) return this.dayMonthYear.format(date);
    return windowLength > 10 * DAY ? this.dayMonth.format(date) : this.weekdayDay(date);
  }

  private datePart(date: Date, thisYear: number): string {
    return date.getFullYear() === thisYear
      ? this.weekdayDate.format(date)
      : this.weekdayDateYear.format(date);
  }
}

/** `YYYY-MM-DD HH:mm:ss` in local time, for the CSV time column. */
export function csvTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** `YYYY-MM-DD`, or `YYYY-MM-DD_HHmm` with `withTime`, for file names. */
export function fileStamp(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date}_${pad(d.getHours())}${pad(d.getMinutes())}` : date;
}

/** Value for an `<input type="datetime-local">`. */
export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function fromDatetimeLocal(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return undefined;
  const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export function isLocalMidnight(ms: number): boolean {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}
