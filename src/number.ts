import type { FrontendLocale } from './ha-types';

/** Number formatting that follows the Home Assistant profile's number format. */
export class NumberFormatter {
  private readonly locales: string | string[] | undefined;
  private readonly grouping: boolean;
  private readonly cache = new Map<string, Intl.NumberFormat>();

  constructor(locale: FrontendLocale) {
    switch (locale.number_format) {
      case 'comma_decimal':
        this.locales = ['en-US', 'en'];
        break;
      case 'decimal_comma':
        this.locales = ['de', 'es', 'it'];
        break;
      case 'space_comma':
        this.locales = ['fr', 'sv', 'cs'];
        break;
      case 'system':
        this.locales = undefined;
        break;
      default:
        this.locales = locale.language;
    }
    this.grouping = locale.number_format !== 'none';
  }

  /** Formats with a fixed number of decimals, or up to two when `decimals` is unknown. */
  format(value: number, decimals?: number): string {
    const key = decimals === undefined ? 'auto' : String(decimals);
    let formatter = this.cache.get(key);
    if (!formatter) {
      formatter = this.create(
        decimals === undefined
          ? { maximumFractionDigits: 2 }
          : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
      );
      this.cache.set(key, formatter);
    }
    return formatter.format(value);
  }

  /** Short axis labels: 950, 1.2K, 3.4M. */
  compact(value: number): string {
    let formatter = this.cache.get('compact');
    if (!formatter) {
      formatter = this.create({ notation: 'compact', maximumFractionDigits: 1 });
      this.cache.set('compact', formatter);
    }
    return formatter.format(value);
  }

  private create(options: Intl.NumberFormatOptions): Intl.NumberFormat {
    try {
      return new Intl.NumberFormat(this.locales, { useGrouping: this.grouping, ...options });
    } catch {
      return new Intl.NumberFormat('en', { useGrouping: this.grouping, ...options });
    }
  }
}

/** Decimal places written in a state string, so "21.50" keeps two. */
export function decimalsOf(state: string): number | undefined {
  const match = /^-?\d+(?:\.(\d+))?$/.exec(state.trim());
  if (!match) return undefined;
  return Math.min(match[1]?.length ?? 0, 6);
}

/** Parses a Home Assistant state into a number; text states become NaN (a gap). */
export function stateToNumber(state: string | undefined | null): number {
  if (state === undefined || state === null || state === '') return NaN;
  const value = Number(state);
  return Number.isFinite(value) ? value : NaN;
}
