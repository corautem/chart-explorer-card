import { sameFamily, unitFactor } from '../units';

/** One meter in a ratio: its rise in each period, its unit, and whether it is a meter at all. */
export interface RatioPart {
  id: string;
  /** Rise per period, signed; NaN where nothing was recorded. */
  change: number[];
  unit: string;
  meter: boolean;
  found: boolean;
}

/** A ratio per period, with the sums it comes from. */
export interface RatioPeriods {
  t: number[];
  end: number[];
  /** The numerator meters' rise per period, in the first numerator's unit. */
  num: number[];
  /** The divisor meters' rise per period, in the first divisor's unit. */
  den: number[];
  /** num / den per period; NaN where the divisor rose less than `min`. */
  v: number[];
  /** Empty when both sides share a family (kWh / Wh), otherwise such as "kWh/m³". */
  unit: string;
  /** What a divisor rise is multiplied by to bring it into the numerator's unit. */
  denFactor: number;
  /** The smallest divisor rise counted, in the first divisor's unit. */
  min: number;
  /** A part that is missing or is a measurement rather than a meter. */
  problem?: { id: string; reason: 'not_found' | 'measurement' };
}

/** 50 Wh for energy meters, in their own unit (0.05 kWh); otherwise anything above zero. */
export function defaultMinDivisor(unit: string): number {
  return sameFamily(unit, 'Wh') ? 50 * unitFactor('Wh', unit) : 0;
}

/**
 * The parts' rises added up per period, each converted into `unit`. A part
 * with nothing recorded in a period counts as not having moved, as long as
 * another part has; a period where no part recorded anything stays empty.
 */
function sumParts(parts: RatioPart[], unit: string, length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    let total = 0;
    let any = false;
    for (const part of parts) {
      const change = part.change[i];
      if (!Number.isFinite(change)) continue;
      total += change * unitFactor(part.unit, unit);
      any = true;
    }
    out.push(any ? total : NaN);
  }
  return out;
}

/**
 * Per period: the numerator meters' rise divided by the divisor meters' rise,
 * signed, so a meter that dips (a defrost) lowers the numerator. A divisor
 * that rose less than the minimum leaves the period empty.
 */
export function ratioPeriods(
  t: number[],
  end: number[],
  numerator: RatioPart[],
  divisor: RatioPart[],
  minDivisor?: number,
): RatioPeriods {
  const numUnit = numerator[0]?.unit ?? '';
  const denUnit = divisor[0]?.unit ?? '';
  const num = sumParts(numerator, numUnit, t.length);
  const den = sumParts(divisor, denUnit, t.length);
  const same = numUnit === denUnit || sameFamily(numUnit, denUnit);
  const denFactor = same ? unitFactor(denUnit, numUnit) : 1;
  const min = minDivisor ?? defaultMinDivisor(denUnit);
  const v = num.map((n, i) => {
    const d = den[i];
    return Number.isFinite(n) && Number.isFinite(d) && d > 0 && d >= min ? n / (d * denFactor) : NaN;
  });
  const missing = [...numerator, ...divisor].find((part) => !part.found);
  const measurement = [...numerator, ...divisor].find((part) => part.found && !part.meter);
  // With a part missing or not a meter there is no ratio at all, not even from the raw history of the period in progress.
  const none = () => t.map(() => NaN);
  const broken = Boolean(missing || measurement);
  return {
    t,
    end,
    num: broken ? none() : num,
    den: broken ? none() : den,
    v: broken ? none() : v,
    unit: same ? '' : `${numUnit}/${denUnit}`,
    denFactor,
    min,
    problem: missing ? { id: missing.id, reason: 'not_found' } : measurement ? { id: measurement.id, reason: 'measurement' } : undefined,
  };
}

/** Whether a period lies at least partly inside [start, until), as `windowValue` counts them. */
const inside = (ratio: RatioPeriods, i: number, start: number, until: number) => ratio.end[i] > start && ratio.t[i] < until;

/**
 * The ratio over a window: the sum of the numerator's rises over the sum of
 * the divisor's, never the mean of the periods' ratios.
 */
export function windowRatio(ratio: RatioPeriods, start: number, until: number): number {
  let num = 0;
  let den = 0;
  let any = false;
  ratio.t.forEach((_, i) => {
    if (!inside(ratio, i, start, until) || !Number.isFinite(ratio.num[i]) || !Number.isFinite(ratio.den[i])) return;
    num += ratio.num[i];
    den += ratio.den[i];
    any = true;
  });
  return any && den > 0 && den >= ratio.min ? num / (den * ratio.denFactor) : NaN;
}

/**
 * The ratio from the window start to the end of each period ("COP so far"),
 * empty until the divisor has risen by the minimum, and outside the window.
 */
export function runningRatio(ratio: RatioPeriods, start: number, until: number): number[] {
  let num = 0;
  let den = 0;
  return ratio.t.map((_, i) => {
    if (!inside(ratio, i, start, until)) return NaN;
    if (Number.isFinite(ratio.num[i]) && Number.isFinite(ratio.den[i])) {
      num += ratio.num[i];
      den += ratio.den[i];
    }
    return den > 0 && den >= ratio.min ? num / (den * ratio.denFactor) : NaN;
  });
}
