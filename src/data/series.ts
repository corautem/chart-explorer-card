import type { Series } from './types';

export function emptySeries(): Series {
  return { t: [], v: [] };
}

/** Index of the last point at or before `time`, or -1. */
export function indexAtOrBefore(t: readonly number[], time: number): number {
  let low = 0;
  let high = t.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (t[mid] <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Index of the first point at or after `time` (t.length when none). */
export function indexAtOrAfter(t: readonly number[], time: number): number {
  let low = 0;
  let high = t.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (t[mid] < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The value at `time` as Home Assistant states work: a value holds until the next change. */
export function valueAt(series: Series, time: number): number {
  const i = indexAtOrBefore(series.t, time);
  return i < 0 ? NaN : series.v[i];
}

/** The state text at `time`, for series that keep it. */
export function stateAt(series: Series, time: number): string | undefined {
  const i = indexAtOrBefore(series.t, time);
  return i < 0 ? undefined : series.s?.[i];
}

const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * Appends a live point; returns false when it adds nothing (older, or an
 * unchanged value). Series that keep state text compare the text.
 */
export function appendPoint(series: Series, time: number, value: number, text?: string): boolean {
  const n = series.t.length;
  const keepsText = series.s !== undefined;
  if (n > 0) {
    const lastTime = series.t[n - 1];
    if (time < lastTime) return false;
    if (keepsText ? series.s?.[n - 1] === text : same(series.v[n - 1], value)) return false;
    if (time === lastTime) {
      series.v[n - 1] = value;
      if (keepsText) (series.s as string[])[n - 1] = text ?? '';
      return true;
    }
  }
  series.t.push(time);
  series.v.push(value);
  if (keepsText) series.s?.push(text ?? '');
  series.min?.push(value);
  series.max?.push(value);
  return true;
}

/** Drops points before `time`, keeping the last one before it so the line starts at the edge. */
export function trimBefore(series: Series, time: number): void {
  const i = indexAtOrBefore(series.t, time);
  if (i <= 0) return;
  series.t.splice(0, i);
  series.v.splice(0, i);
  series.s?.splice(0, i);
  series.min?.splice(0, i);
  series.max?.splice(0, i);
}

export function concatSeries(a: Series, b: Series, withBand: boolean): Series {
  if (!b.t.length) return a;
  if (!a.t.length) return b;
  const joined: Series = { t: a.t.concat(b.t), v: a.v.concat(b.v) };
  if (withBand) {
    joined.min = (a.min ?? a.v).concat(b.min ?? b.v);
    joined.max = (a.max ?? a.v).concat(b.max ?? b.v);
  }
  return joined;
}

/**
 * Thins a series for drawing to at most four points per pixel column: the
 * first, lowest, highest and last point of each column, so peaks and dips
 * survive. Includes the last point before `start` so the line enters the
 * window from the left edge, and the first point after `end`.
 */
export function decimate(
  series: Series,
  start: number,
  end: number,
  columns: number,
): { t: number[]; v: number[] } {
  const { t, v } = series;
  const from = Math.max(0, indexAtOrBefore(t, start));
  const to = Math.min(t.length, indexAtOrBefore(t, end) + 2);
  if (to - from <= columns * 4 || end <= start || columns < 1) {
    return { t: t.slice(from, to), v: v.slice(from, to) };
  }

  const outT: number[] = [];
  const outV: number[] = [];
  const width = (end - start) / columns;
  const picks: number[] = [];
  let i = from;
  while (i < to) {
    const bucketEnd = start + (Math.floor((t[i] - start) / width) + 1) * width;
    const first = i;
    let low = -1;
    let high = -1;
    for (; i < to && t[i] < bucketEnd; i++) {
      const value = v[i];
      if (Number.isNaN(value)) continue;
      if (low < 0 || value < v[low]) low = i;
      if (high < 0 || value > v[high]) high = i;
    }
    const last = i - 1;
    picks.length = 0;
    picks.push(first);
    if (low > first) picks.push(low);
    if (high > first) picks.push(high);
    if (last > first) picks.push(last);
    picks.sort((a, b) => a - b);
    let previous = -1;
    for (const k of picks) {
      if (k === previous) continue;
      previous = k;
      outT.push(t[k]);
      outV.push(v[k]);
    }
  }
  return { t: outT, v: outV };
}

/**
 * Adds a point just before each change that follows a long pause, so a value
 * that held for hours draws flat and then changes rather than as a long slope.
 * Home Assistant records changes only, so raw history needs this; statistics
 * buckets do not. A pause counts as long when it exceeds `minGap` and four
 * times the series' usual spacing, so a sensor that reports every 15 minutes
 * still draws as a curve. Applies to points from `from` on.
 */
export function holdValues(
  data: { t: number[]; v: number[] },
  minGap: number,
  from = Number.NEGATIVE_INFINITY,
): { t: number[]; v: number[] } {
  const threshold = Math.max(minGap, 4 * medianGap(data.t));
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < data.t.length; i++) {
    if (i > 0 && data.t[i] >= from) {
      const gap = data.t[i] - data.t[i - 1];
      const previous = data.v[i - 1];
      if (gap > threshold && !Number.isNaN(previous)) {
        t.push(data.t[i] - minGap / 2);
        v.push(previous);
      }
    }
    t.push(data.t[i]);
    v.push(data.v[i]);
  }
  return { t, v };
}

function medianGap(t: number[]): number {
  if (t.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}
