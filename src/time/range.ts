import {
  MINUTE,
  addMonthsClamped,
  approximateMs,
  parseQuickRange,
  quickFromMinutes,
  rollingEnd,
  rollingStart,
  sameLength,
  type QuickRange,
} from './duration';

export const PRESET_IDS = [
  'today',
  'yesterday',
  'tomorrow',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];
export type CalendarUnit = 'day' | 'week' | 'month' | 'year';

/**
 * A window that spans the past and the future: a start and a length.
 * `-12h+60h` starts 12 hours ago and runs 60 hours (to 48 hours ahead);
 * `today+72h` starts at midnight and runs three days.
 */
export interface Span {
  id: string;
  /** How far before now the window starts, or the calendar period it starts with. */
  start: { kind: 'offset'; back: QuickRange } | { kind: 'preset'; id: PresetId };
  length: QuickRange;
}

/**
 * What the user picked. The actual start and end follow from it and the
 * current time, so a rolling window keeps sliding and "this week" stays this week.
 */
export type RangeSpec =
  | { kind: 'rolling'; quick: QuickRange }
  | { kind: 'calendar'; unit: CalendarUnit; offset: number }
  | { kind: 'span'; span: Span }
  // `rolling` and `span` remember the window a stepped one came from,
  // so stepping forward onto the present makes it live again.
  | { kind: 'fixed'; start: number; end: number; rolling?: QuickRange; span?: Span };

/** Milliseconds since the epoch; `end` is exclusive. */
export interface TimeWindow {
  start: number;
  end: number;
}

const PRESETS: Record<PresetId, { unit: CalendarUnit; offset: number }> = {
  today: { unit: 'day', offset: 0 },
  yesterday: { unit: 'day', offset: -1 },
  tomorrow: { unit: 'day', offset: 1 },
  this_week: { unit: 'week', offset: 0 },
  last_week: { unit: 'week', offset: -1 },
  this_month: { unit: 'month', offset: 0 },
  last_month: { unit: 'month', offset: -1 },
  this_year: { unit: 'year', offset: 0 },
  last_year: { unit: 'year', offset: -1 },
};

export function isPresetId(text: string): text is PresetId {
  return (PRESET_IDS as readonly string[]).includes(text);
}

export function presetSpec(id: PresetId): RangeSpec {
  return { kind: 'calendar', ...PRESETS[id] };
}

/** The preset a calendar spec corresponds to, if any (two weeks ago has none). */
export function presetOf(spec: RangeSpec): PresetId | undefined {
  if (spec.kind !== 'calendar') return undefined;
  return PRESET_IDS.find(
    (id) => PRESETS[id].unit === spec.unit && PRESETS[id].offset === spec.offset,
  );
}

/** An entry in the quick ranges or the menu: a rolling length, a span or a calendar preset. */
export type RangeItem =
  | { kind: 'length'; quick: QuickRange }
  | { kind: 'span'; span: Span }
  | { kind: 'preset'; id: PresetId };

/** Parses `-12h+60h` (start 12 hours ago, 60 hours long) or `today+72h` (start at midnight). */
export function parseSpan(text: string): Span | undefined {
  const match = /^\s*(?:-\s*(\d+\s*(?:mo|m|h|d|w|y))|([a-z_]+))\s*\+\s*(\d+\s*(?:mo|m|h|d|w|y))\s*$/.exec(text);
  if (!match) return undefined;
  const length = parseQuickRange(match[3]);
  if (!length) return undefined;
  if (match[2]) {
    if (!isPresetId(match[2])) return undefined;
    return { id: `${match[2]}+${length.id}`, start: { kind: 'preset', id: match[2] }, length };
  }
  const back = parseQuickRange(match[1]);
  return back ? { id: `-${back.id}+${length.id}`, start: { kind: 'offset', back }, length } : undefined;
}

export function parseRangeItem(text: string): RangeItem | undefined {
  const trimmed = text.trim();
  if (isPresetId(trimmed)) return { kind: 'preset', id: trimmed };
  const span = parseSpan(trimmed);
  if (span) return { kind: 'span', span };
  const quick = parseQuickRange(trimmed);
  return quick ? { kind: 'length', quick } : undefined;
}

export function rangeItemId(item: RangeItem): string {
  return item.kind === 'preset' ? item.id : item.kind === 'span' ? item.span.id : item.quick.id;
}

export function rangeItemSpec(item: RangeItem): RangeSpec {
  if (item.kind === 'preset') return presetSpec(item.id);
  return item.kind === 'span' ? { kind: 'span', span: item.span } : { kind: 'rolling', quick: item.quick };
}

/** True when the shown window is this entry (a stepped "this week" is not). */
export function rangeItemActive(item: RangeItem, spec: RangeSpec | undefined): boolean {
  if (!spec) return false;
  if (item.kind === 'preset') return presetOf(spec) === item.id;
  if (item.kind === 'span') return spec.kind === 'span' && spec.span.id === item.span.id;
  return spec.kind === 'rolling' && sameLength(spec.quick, item.quick);
}

/** Lengths shortest first, then presets in their usual order, without repeats. */
export function sortRangeItems(items: RangeItem[]): RangeItem[] {
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const id = rangeItemId(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const lengths = unique.filter((i): i is Extract<RangeItem, { kind: 'length' }> => i.kind === 'length');
  const spans = unique.filter((i): i is Extract<RangeItem, { kind: 'span' }> => i.kind === 'span');
  const presets = unique.filter((i): i is Extract<RangeItem, { kind: 'preset' }> => i.kind === 'preset');
  // Past lengths first, then the ones running into the future, each shortest first.
  lengths.sort(
    (a, b) =>
      Number(Boolean(a.quick.forward)) - Number(Boolean(b.quick.forward)) ||
      approximateMs(a.quick) - approximateMs(b.quick),
  );
  presets.sort((a, b) => PRESET_IDS.indexOf(a.id) - PRESET_IDS.indexOf(b.id));
  return [...lengths, ...spans, ...presets];
}

/** Parses a `default_range` value: a preset id, a span such as `-12h+60h`, or a quick range such as `24h`. */
export function parseRangeSpec(text: string): RangeSpec | undefined {
  const item = parseRangeItem(text);
  return item ? rangeItemSpec(item) : undefined;
}

/** Local-time start of the day, week, month or year containing `ms`. */
export function startOfUnit(ms: number, unit: CalendarUnit, weekStart: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  if (unit === 'week') {
    date.setDate(date.getDate() - ((date.getDay() - weekStart + 7) % 7));
  } else if (unit === 'month') {
    date.setDate(1);
  } else if (unit === 'year') {
    date.setMonth(0, 1);
  }
  return date.getTime();
}

/** Adds calendar units to a local-time unit start (DST-safe). */
export function addUnits(ms: number, unit: CalendarUnit, count: number): number {
  const date = new Date(ms);
  if (unit === 'day') date.setDate(date.getDate() + count);
  else if (unit === 'week') date.setDate(date.getDate() + 7 * count);
  else if (unit === 'month') date.setMonth(date.getMonth() + count);
  else date.setFullYear(date.getFullYear() + count);
  return date.getTime();
}

/**
 * The end of a span. From a calendar start, whole days (72h as well as 3d)
 * count by the calendar, so the window still ends at midnight across a clock change.
 */
function spanEnd(start: number, length: QuickRange, calendar: boolean): number {
  if (calendar && length.unit === 'h' && length.amount % 24 === 0) return addUnits(start, 'day', length.amount / 24);
  if (calendar && length.unit === 'd') return addUnits(start, 'day', length.amount);
  if (calendar && length.unit === 'w') return addUnits(start, 'week', length.amount);
  if (length.unit === 'mo' || length.unit === 'y') return addMonthsClamped(start, (length.unit === 'y' ? 12 : 1) * length.amount);
  return rollingEnd(start, length);
}

export function resolveWindow(spec: RangeSpec, now: number, weekStart: number): TimeWindow {
  switch (spec.kind) {
    case 'span': {
      const { start: from, length } = spec.span;
      const start =
        from.kind === 'offset' ? rollingStart(now, from.back) : resolveWindow(presetSpec(from.id), now, weekStart).start;
      return { start, end: spanEnd(start, length, from.kind === 'preset') };
    }
    case 'rolling':
      return spec.quick.forward
        ? { start: now, end: rollingEnd(now, spec.quick) }
        : { start: rollingStart(now, spec.quick), end: now };
    case 'calendar': {
      const start = addUnits(startOfUnit(now, spec.unit, weekStart), spec.unit, spec.offset);
      return { start, end: addUnits(start, spec.unit, 1) };
    }
    case 'fixed':
      return { start: spec.start, end: spec.end };
  }
}

/**
 * Moves the window by its own length. Calendar windows move by calendar
 * period (October back to September); other windows by their exact duration.
 */
export function stepSpec(
  spec: RangeSpec,
  direction: 1 | -1,
  now: number,
  weekStart: number,
): RangeSpec {
  if (spec.kind === 'calendar') return { ...spec, offset: spec.offset + direction };
  const current = resolveWindow(spec, now, weekStart);
  const length = current.end - current.start;
  const start = current.start + direction * length;
  const end = current.end + direction * length;
  const origin = spec.kind === 'rolling' ? spec.quick : spec.kind === 'fixed' ? spec.rolling : undefined;
  const span = spec.kind === 'span' ? spec.span : spec.kind === 'fixed' ? spec.span : undefined;
  // Landing where the live window is (within half a window) turns a stepped window live again.
  if (spec.kind === 'fixed' && (origin || span)) {
    const liveSpec: RangeSpec = span ? { kind: 'span', span } : { kind: 'rolling', quick: origin as QuickRange };
    const live = resolveWindow(liveSpec, now, weekStart);
    if (Math.abs(start - live.start) < length / 2) return liveSpec;
  }
  return { kind: 'fixed', start, end, rolling: origin, span };
}

/** The "Now" button: the same kind of window, brought to the present. */
export function nowSpec(spec: RangeSpec): RangeSpec {
  switch (spec.kind) {
    case 'rolling':
      return spec;
    case 'calendar':
      return { ...spec, offset: 0 };
    case 'span':
      return spec;
    case 'fixed': {
      if (spec.span) return { kind: 'span', span: spec.span };
      if (spec.rolling) return { kind: 'rolling', quick: spec.rolling };
      const minutes = Math.max(1, Math.round((spec.end - spec.start) / MINUTE));
      return { kind: 'rolling', quick: quickFromMinutes(minutes) };
    }
  }
}

/** Calendar windows end at midnight; the label shows the last minute instead (23:59). */
export function labelEndIsInclusive(spec: RangeSpec): boolean {
  return spec.kind === 'calendar' || (spec.kind === 'span' && spec.span.start.kind === 'preset' && calendarLength(spec.span.length));
}

/** Whether a length is whole days, weeks, months or years, so a span from midnight ends at midnight. */
function calendarLength(length: QuickRange): boolean {
  return length.unit !== 'm' && (length.unit !== 'h' || length.amount % 24 === 0);
}

/** Whether the window follows the calendar (a new day moves it) rather than sliding with the clock. */
export function followsCalendar(spec: RangeSpec): boolean {
  return spec.kind === 'calendar' || (spec.kind === 'span' && spec.span.start.kind === 'preset');
}

/** Whether the window slides with the clock: rolling lengths and spans that start some time before now. */
export function slides(spec: RangeSpec): boolean {
  return spec.kind === 'rolling' || (spec.kind === 'span' && spec.span.start.kind === 'offset');
}

export function containsNow(window: TimeWindow, now: number): boolean {
  return window.start <= now && now <= window.end;
}
