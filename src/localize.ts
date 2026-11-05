import { MINUTE, fixedLengthMs, quickFromMinutes, type QuickRange } from './time/duration';
import type { PresetId, RangeItem, Span } from './time/range';

const STRINGS = {
  previous: 'Previous period',
  next: 'Next period',
  now: 'Now',
  now_hint: 'Same length, up to now',
  presets: 'Presets',
  quick_ranges: 'Quick ranges',
  custom: 'Custom…',
  custom_range: 'Custom range',
  from: 'From',
  to: 'To',
  apply: 'Apply',
  cancel: 'Cancel',
  invalid_range: '"From" must be before "To".',
  download: 'Download',
  download_csv: 'CSV of what is shown',
  download_png: 'PNG image',
  loading: 'Loading…',
  retry: 'Retry',
  load_failed: 'Could not load the data.',
  no_data: 'No data for this range',
  not_found: 'Entity not found',
  no_history: 'No history for this period',
  more_info: 'Show details',
  total_shown: 'Total of the bars shown. Tap for details.',
  ratio_shown: 'Ratio over the whole window shown. Tap for details.',
  fade: 'Fade or show the line',
  edit_range: 'Choose a custom range',
} as const;

const PRESET_NAMES: Record<PresetId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
  last_year: 'Last year',
};

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey): string {
  return STRINGS[key];
}

export function presetName(id: PresetId): string {
  return PRESET_NAMES[id];
}

const UNIT_WORDS: Record<QuickRange['unit'], [string, string]> = {
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  w: ['week', 'weeks'],
  mo: ['month', 'months'],
  y: ['year', 'years'],
};

/**
 * A rolling length in words: "Past 45 minutes", "Past week", "Next 6 hours".
 * "Past" keeps it apart from the calendar presets ("Last week" is Monday to Sunday).
 */
export function lengthName(range: QuickRange): string {
  const [one, many] = UNIT_WORDS[range.unit];
  const word = range.forward ? 'Next' : 'Past';
  return range.amount === 1 ? `${word} ${one}` : `${word} ${range.amount} ${many}`;
}

/** "12 hours", "1 day": an amount in words. */
function amountName(range: QuickRange): string {
  const [one, many] = UNIT_WORDS[range.unit];
  return range.amount === 1 ? `1 ${one}` : `${range.amount} ${many}`;
}

/** Where a span starting before now ends, relative to now: 48 hours ahead, or (if negative) some time ago. */
function spanEnd(span: Span): { ahead: boolean; range: QuickRange } | undefined {
  if (span.start.kind !== 'offset') return undefined;
  const back = fixedLengthMs(span.start.back);
  const length = fixedLengthMs(span.length);
  if (back === undefined || length === undefined) return undefined;
  const end = length - back;
  return { ahead: end >= 0, range: quickFromMinutes(Math.max(1, Math.round(Math.abs(end) / MINUTE))) };
}

/** "-12h…+48h" and "Today +3d" on a button; whole days from a calendar start count in days. */
function spanButton(span: Span): string {
  if (span.start.kind === 'preset') {
    const days = span.length.unit === 'h' && span.length.amount % 24 === 0 ? `${span.length.amount / 24}d` : span.length.id;
    return `${presetName(span.start.id)} +${days}`;
  }
  const end = spanEnd(span);
  return end ? `-${span.start.back.id}…${end.ahead ? '+' : '-'}${end.range.id}` : span.id;
}

/** "12 hours ago to 48 hours ahead", "Today for 3 days". */
function spanName(span: Span): string {
  if (span.start.kind === 'preset') {
    const length =
      span.length.unit === 'h' && span.length.amount % 24 === 0
        ? amountName({ ...span.length, amount: span.length.amount / 24, unit: 'd' })
        : amountName(span.length);
    return `${presetName(span.start.id)} for ${length}`;
  }
  const end = spanEnd(span);
  const from = `${amountName(span.start.back)} ago`;
  if (!end) return `From ${from}, for ${amountName(span.length)}`;
  return `${from[0].toUpperCase()}${from.slice(1)} to ${amountName(end.range)} ${end.ahead ? 'ahead' : 'ago'}`;
}

/** Text on a toolbar button: "45m" for lengths, "-12h…+48h" for spans, the preset name otherwise. */
export function buttonLabel(item: RangeItem): string {
  if (item.kind === 'span') return spanButton(item.span);
  return item.kind === 'length' ? item.quick.id : presetName(item.id);
}

/** Text in the menu: "Past 45 minutes" for lengths, "12 hours ago to 48 hours ahead" for spans, the preset name otherwise. */
export function menuLabel(item: RangeItem): string {
  if (item.kind === 'span') return spanName(item.span);
  return item.kind === 'length' ? lengthName(item.quick) : presetName(item.id);
}
