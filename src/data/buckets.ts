import type { BarPeriod } from '../config';
import type { HomeAssistant } from '../ha-types';
import { DAY, HOUR } from '../time/duration';
import { addUnits, startOfUnit, type TimeWindow } from '../time/range';
import { fetchHistory } from './history';
import type { MetaCache } from './loader';
import { fetchStatistics, isMeanType, num, rowTime, type StatisticsPeriod, type StatisticsRow } from './statistics';
import type { BucketData, BucketPeriod, Buckets, Series } from './types';

/** The bar length for a window: hours up to two days, then days, weeks and months. */
export function bucketPeriodFor(window: TimeWindow, setting: BarPeriod): BucketPeriod {
  if (setting !== 'auto') return setting;
  const length = window.end - window.start;
  if (length <= 2 * DAY + HOUR) return 'hour';
  if (length <= 45 * DAY) return 'day';
  if (length <= 200 * DAY) return 'week';
  return 'month';
}

/**
 * Start of the local hour containing `ms`. Worked out by subtracting the
 * minutes past the hour rather than by setting the clock to the hour, which in
 * the hour repeated when clocks go back can land on its first occurrence.
 */
function hourStart(ms: number): number {
  const date = new Date(ms);
  return ms - (date.getMinutes() * 60_000 + date.getSeconds() * 1000 + date.getMilliseconds());
}

/** Start of the local hour, day, week or month containing `ms`. */
export function periodStart(ms: number, period: BucketPeriod, weekStart: number): number {
  return period === 'hour' ? hourStart(ms) : startOfUnit(ms, period, weekStart);
}

function nextPeriod(ms: number, period: BucketPeriod): number {
  return period === 'hour' ? hourStart(ms + HOUR) : addUnits(ms, period, 1);
}

/** Edges of the local periods that overlap [start, end): each period runs from one edge to the next. */
export function periodEdges(start: number, end: number, period: BucketPeriod, weekStart: number): number[] {
  const edges = [periodStart(start, period, weekStart)];
  // 20,000 periods is over two years of hours; longer windows use longer periods.
  while (edges[edges.length - 1] < end && edges.length < 20_000) {
    const last = edges[edges.length - 1];
    edges.push(Math.max(nextPeriod(last, period), last + HOUR));
  }
  if (edges.length === 1) edges.push(nextPeriod(edges[0], period));
  return edges;
}

/** Running totals for one period. */
export interface Accumulator {
  weighted: number;
  weight: number;
  min: number;
  max: number;
  change: number;
  changed: boolean;
}

export function accumulators(count: number): Accumulator[] {
  return Array.from({ length: count }, () => ({ weighted: 0, weight: 0, min: NaN, max: NaN, change: 0, changed: false }));
}

/** Index of the period containing `time`, or -1 outside the edges. */
function periodIndex(edges: number[], time: number): number {
  let low = 0;
  let high = edges.length - 2;
  if (high < 0 || time < edges[0] || time >= edges[edges.length - 1]) return -1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (edges[mid] <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

function addExtremes(acc: Accumulator, low: number, high: number): void {
  if (Number.isFinite(low) && !(acc.min <= low)) acc.min = low;
  if (Number.isFinite(high) && !(acc.max >= high)) acc.max = high;
}

/** Adds one statistics row to the period its start falls in; `until` caps the time it stands for. */
export function addRow(accs: Accumulator[], edges: number[], row: StatisticsRow, length: number, until = Infinity): void {
  const start = rowTime(row.start);
  const i = periodIndex(edges, start);
  if (i < 0) return;
  const acc = accs[i];
  const end = Math.min(Number.isFinite(rowTime(row.end)) ? rowTime(row.end) : start + length, until);
  const mean = num(row.mean);
  if (Number.isFinite(mean) && end > start) {
    acc.weighted += mean * (end - start);
    acc.weight += end - start;
  }
  addExtremes(acc, num(row.min), num(row.max));
  const change = num(row.change);
  if (Number.isFinite(change)) {
    acc.change += change;
    acc.changed = true;
  }
}

/**
 * Adds raw history between `from` and `to`: the value held over each stretch
 * of time counts towards the average of the periods it covers, and each rise
 * of a meter towards the period it happened in. A meter that drops has been
 * reset and counts from zero, unless `increasing` is false (a meter that may
 * go down, such as one for energy returned to the grid).
 */
export function addRaw(
  accs: Accumulator[],
  edges: number[],
  series: Series,
  from: number,
  to: number,
  increasing = true,
): void {
  const { t, v } = series;
  let previous = NaN;
  for (let i = 0; i < t.length; i++) {
    const value = v[i];
    if (Number.isNaN(value)) continue;
    if (t[i] > from && t[i] < to && Number.isFinite(previous)) {
      const k = periodIndex(edges, t[i]);
      if (k >= 0) {
        accs[k].change += value >= previous || !increasing ? value - previous : value;
        accs[k].changed = true;
      }
    }
    previous = value;
    let start = Math.max(t[i], from);
    const end = Math.min(i + 1 < t.length ? t[i + 1] : to, to);
    while (start < end) {
      const k = periodIndex(edges, start);
      if (k < 0) break;
      const stop = Math.min(end, edges[k + 1]);
      const acc = accs[k];
      acc.weighted += value * (stop - start);
      acc.weight += stop - start;
      addExtremes(acc, value, value);
      start = stop;
    }
  }
}

export function finish(accs: Accumulator[], edges: number[]): Buckets {
  const out: Buckets = { t: [], end: [], mean: [], min: [], max: [], change: [] };
  accs.forEach((acc, i) => {
    out.t.push(edges[i]);
    out.end.push(edges[i + 1]);
    out.mean.push(acc.weight > 0 ? acc.weighted / acc.weight : NaN);
    out.min.push(acc.min);
    out.max.push(acc.max);
    out.change.push(acc.changed ? acc.change : NaN);
  });
  return out;
}

const FETCH_PERIOD: Record<BucketPeriod, StatisticsPeriod> = { hour: 'hour', day: 'day', week: 'day', month: 'month' };
const FETCH_LENGTH: Record<BucketPeriod, number> = { hour: HOUR, day: DAY, week: DAY, month: 31 * DAY };
const TAIL = 3 * HOUR;

/**
 * Values per local period for bars, pies and heatmaps. Entities with long-term
 * statistics use them; Home Assistant compiles them once an hour, so the hour
 * in progress comes from raw history. Entities without statistics use raw
 * history throughout. Periods follow the device's time zone and week start.
 */
export async function loadBuckets(
  hass: HomeAssistant,
  entityIds: string[],
  window: TimeWindow,
  now: number,
  period: BucketPeriod,
  meta: MetaCache,
  weekStart = 1,
): Promise<BucketData> {
  const ids = [...new Set(entityIds)];
  const until = Math.min(window.end, now);
  const edges = periodEdges(window.start, Math.max(until, window.start + 1), period, weekStart);
  const result: BucketData = { period, entities: new Map() };
  if (until <= window.start) {
    for (const id of ids) result.entities.set(id, { buckets: finish(accumulators(edges.length - 1), edges), meanType: true });
    return result;
  }
  await meta.ensure(hass, ids);
  const statIds = ids.filter((id) => meta.get(id));
  const rawIds = ids.filter((id) => !meta.get(id));
  // Within the last few hours some data has not been compiled into statistics yet.
  const live = until > now - 2 * HOUR;
  const fetchPeriod = FETCH_PERIOD[period];
  const [stats, probe, tail, raw] = await Promise.all([
    fetchStatistics(hass, statIds, edges[0], until, fetchPeriod, ['mean', 'min', 'max', 'change']),
    live && fetchPeriod !== 'hour'
      ? fetchStatistics(hass, statIds, until - TAIL, until, 'hour', ['mean'])
      : Promise.resolve(undefined),
    live ? fetchHistory(hass, statIds, until - TAIL, until) : Promise.resolve(new Map<string, Series>()),
    fetchHistory(hass, rawIds, edges[0], until),
  ]);

  const increasing = (id: string) => hass.states[id]?.attributes.state_class !== 'total';
  for (const id of statIds) {
    const accs = accumulators(edges.length - 1);
    const rows = stats[id] ?? [];
    // Where compiled statistics end: the end of the newest hourly row.
    const hourly = fetchPeriod === 'hour' ? rows : (probe?.[id] ?? []);
    const newest = hourly.length ? rowTime(hourly[hourly.length - 1].start) + HOUR : until - TAIL;
    const covered = live ? Math.min(until, newest) : until;
    for (const row of rows) addRow(accs, edges, row, FETCH_LENGTH[period], covered);
    const recent = tail.get(id);
    if (live && recent && covered < until) addRaw(accs, edges, recent, covered, until, increasing(id));
    const info = meta.get(id);
    result.entities.set(id, {
      buckets: finish(accs, edges),
      meanType: info ? isMeanType(info) : true,
      unit: info?.statistics_unit_of_measurement ?? undefined,
    });
  }
  for (const id of rawIds) {
    const accs = accumulators(edges.length - 1);
    const series = raw.get(id);
    if (series) addRaw(accs, edges, series, window.start, until, increasing(id));
    result.entities.set(id, { buckets: finish(accs, edges), meanType: true });
  }
  return result;
}

/** The value a period shows: a meter's rise, otherwise the chosen statistic. */
export function bucketValues(buckets: Buckets, meanType: boolean, statistic?: string): number[] {
  if (!meanType) return buckets.change;
  if (statistic === 'min') return buckets.min;
  if (statistic === 'max') return buckets.max;
  return buckets.mean;
}

/** The value of the period containing `time`. */
export function bucketAt(buckets: { t: number[]; end: number[]; v: number[] }, time: number): number {
  let low = 0;
  let high = buckets.t.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (time < buckets.t[mid]) high = mid - 1;
    else if (time >= buckets.end[mid]) low = mid + 1;
    else return buckets.v[mid];
  }
  return NaN;
}

/**
 * One value for the periods overlapping [start, until): a meter's total rise,
 * or for measurements the average weighted by time (or the lowest or highest).
 */
export function windowValue(
  buckets: { t: number[]; end: number[]; v: number[]; meanType: boolean },
  start: number,
  until: number,
  statistic?: string,
): number {
  let sum = 0;
  let weight = 0;
  let low = Infinity;
  let high = -Infinity;
  let any = false;
  buckets.t.forEach((from, i) => {
    const value = buckets.v[i];
    const to = buckets.end[i];
    if (!Number.isFinite(value) || to <= start || from >= until) return;
    any = true;
    const overlap = Math.min(to, until) - Math.max(from, start);
    sum += buckets.meanType ? value * overlap : value;
    weight += overlap;
    low = Math.min(low, value);
    high = Math.max(high, value);
  });
  if (!any) return NaN;
  if (!buckets.meanType) return sum;
  if (statistic === 'min') return low;
  if (statistic === 'max') return high;
  return weight > 0 ? sum / weight : NaN;
}
