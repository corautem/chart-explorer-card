import type { FirstWeekday } from '../ha-types';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Fallback for browsers without Intl week info: regions whose week does not
// start on Monday, following CLDR's week data.
const SUNDAY_REGIONS = new Set(
  (
    'AG AS BD BR BS BT BW BZ CA CN CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM ' +
    'MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'
  ).split(' '),
);
const SATURDAY_REGIONS = new Set(
  'AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '),
);

type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
};

/**
 * First day of the week as a JavaScript weekday (0 = Sunday ... 6 = Saturday).
 * Follows the Home Assistant profile setting; "language" (automatic) uses the
 * browser's locale.
 */
export function resolveWeekStart(
  firstWeekday: FirstWeekday | undefined,
  browserLanguage: string = globalThis.navigator?.language ?? 'en',
): number {
  if (firstWeekday && firstWeekday !== 'language') {
    const index = WEEKDAYS.indexOf(firstWeekday);
    if (index >= 0) return index;
  }
  return localeWeekStart(browserLanguage);
}

export function localeWeekStart(language: string): number {
  try {
    const locale = new Intl.Locale(language) as LocaleWithWeekInfo;
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7;
    const region = locale.maximize().region;
    if (region && SUNDAY_REGIONS.has(region)) return 0;
    if (region && SATURDAY_REGIONS.has(region)) return 6;
    if (region === 'MV') return 5;
  } catch {
    // An invalid language tag falls through to Monday.
  }
  return 1;
}
