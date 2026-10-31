import type { QuickRange } from './time/duration';
import type { PresetId, RangeItem } from './time/range';

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

/** Text on a toolbar button: "45m" for lengths, the preset name otherwise. */
export function buttonLabel(item: RangeItem): string {
  return item.kind === 'length' ? item.quick.id : presetName(item.id);
}

/** Text in the menu: "Past 45 minutes" for lengths, the preset name otherwise. */
export function menuLabel(item: RangeItem): string {
  return item.kind === 'length' ? lengthName(item.quick) : presetName(item.id);
}
