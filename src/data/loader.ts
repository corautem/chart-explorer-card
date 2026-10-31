import type { DataSettings, EntityConfig, StatisticKind } from '../config';
import type { HomeAssistant } from '../ha-types';
import { MINUTE } from '../time/duration';
import type { TimeWindow } from '../time/range';
import { fetchHistory } from './history';
import { PERIOD_MS, chooseResolution } from './resolution';
import { concatSeries, emptySeries, indexAtOrBefore } from './series';
import {
  fetchStatistics,
  fetchStatisticsMeta,
  isMeanType,
  toColumns,
  type StatisticsMeta,
} from './statistics';
import { loadBuckets } from './buckets';
import type { BucketPeriod, EntityData, LoadedData, Resolution, Series, StatColumns } from './types';

/**
 * What the card knows about the recorder: which entities have long-term
 * statistics, and from when raw history exists. Home Assistant does not report
 * how long the recorder keeps raw history, so the card learns it from replies.
 */
export class MetaCache {
  private readonly known = new Map<string, StatisticsMeta | null>();
  private boundary?: { at: number; observed: number };

  async ensure(hass: HomeAssistant, ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !this.known.has(id));
    if (!missing.length) return;
    const found = await fetchStatisticsMeta(hass, missing);
    for (const id of missing) this.known.set(id, found.get(id) ?? null);
  }

  get(id: string): StatisticsMeta | undefined {
    return this.known.get(id) ?? undefined;
  }

  /** Raw history was missing before `time` while statistics existed. */
  learnRawSince(time: number, now: number): void {
    if (!this.boundary || time < this.rawSince(now)!) this.boundary = { at: time, observed: now };
  }

  /** The learned start of raw history; it moves forward as the recorder purges. */
  rawSince(now: number): number | undefined {
    return this.boundary ? this.boundary.at + (now - this.boundary.observed) : undefined;
  }
}

/** A few recently loaded past windows, for stepping back and forth without new requests. */
export class WindowCache {
  private readonly entries = new Map<string, LoadedData>();

  constructor(private readonly size: number) {}

  get(key: string): LoadedData | undefined {
    const data = this.entries.get(key);
    if (data) {
      this.entries.delete(key);
      this.entries.set(key, data);
    }
    return data;
  }

  set(key: string, data: LoadedData): void {
    this.entries.delete(key);
    this.entries.set(key, data);
    while (this.entries.size > this.size) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export function cacheKey(resolution: Resolution, window: TimeWindow, period?: BucketPeriod): string {
  return `${resolution}|${period ?? ''}|${window.start}|${window.end}`;
}

export interface LoadInput {
  hass: HomeAssistant;
  entityIds: string[];
  window: TimeWindow;
  now: number;
  settings: DataSettings;
  meta: MetaCache;
  /** Loads at this resolution instead of the one the window would get, for the margin around a gesture. */
  resolution?: Resolution;
  /** Entities drawn as a timeline or band: raw history with the state text. */
  textIds?: string[];
  /** Entities drawn as bars, a pie or a heatmap, and the period of each value. */
  bucketIds?: string[];
  bucketPeriod?: BucketPeriod;
  /** First day of the week (0 Sunday), for weekly periods. */
  weekStart?: number;
}

/** Data that starts later than the window does: older history is gone, or never existed. */
const startsLate = (t: number[], start: number) => !t.length || t[0] > start + MINUTE;

export async function loadWindow(input: LoadInput): Promise<LoadedData> {
  const { hass, window, now, settings, meta } = input;
  const textIds = new Set(input.textIds ?? []);
  const ids = [...new Set([...input.entityIds, ...textIds])];
  const resolution = input.resolution ?? chooseResolution(window, settings, meta.rawSince(now));
  const until = Math.min(window.end, now);
  const entities = new Map<string, EntityData>();
  const plain = (id: string, raw?: Series): EntityData => ({
    entityId: id,
    raw: raw ?? (textIds.has(id) ? { t: [], v: [], s: [] } : emptySeries()),
    meanType: true,
  });
  const bucketsLoading =
    input.bucketIds?.length && input.bucketPeriod
      ? loadBuckets(hass, input.bucketIds, window, now, input.bucketPeriod, meta, input.weekStart)
      : undefined;

  /**
   * Fills the start of the window, where finer data is missing, from hourly
   * statistics, up to where the finer data begins.
   */
  const fillStart = async (missing: string[], finerStart: (id: string) => number | undefined) => {
    await meta.ensure(hass, missing);
    const statIds = missing.filter((id) => meta.get(id));
    if (!statIds.length) return;
    const ends = statIds.map((id) => finerStart(id) ?? until);
    const hourly = await fetchStatistics(hass, statIds, window.start, Math.max(...ends), 'hour');
    statIds.forEach((id, i) => {
      const entity = entities.get(id) as EntityData;
      const info = meta.get(id) as StatisticsMeta;
      const columns = sliceColumns(toColumns(hourly[id]), ends[i]);
      if (!columns.t.length) return;
      entity.stats = entity.stats ? concatColumns(columns, entity.stats) : columns;
      entity.meanType = isMeanType(info);
      entity.statisticsUnit = info.statistics_unit_of_measurement ?? undefined;
      const finer = finerStart(id);
      if (finer !== undefined) meta.learnRawSince(finer, now);
    });
  };

  if (until <= window.start) {
    // A window entirely in the future: nothing recorded yet.
    for (const id of ids) entities.set(id, plain(id));
  } else if (resolution === 'raw') {
    const history = await fetchHistory(hass, ids, window.start, until, textIds);
    for (const id of ids) entities.set(id, plain(id, history.get(id)));
    const missing = ids.filter((id) => startsLate((entities.get(id) as EntityData).raw.t, window.start));
    if (missing.length) await fillStart(missing, (id) => (entities.get(id) as EntityData).raw.t[0]);
  } else {
    await meta.ensure(hass, ids);
    const statIds = ids.filter((id) => meta.get(id));
    const rawIds = ids.filter((id) => !meta.get(id));
    const period = PERIOD_MS[resolution];
    // The newest buckets lag behind the clock; their raw history is fetched
    // alongside the statistics so the line reaches the present in one round trip.
    const guessedTail = resolution === '5minute' || resolution === 'hour';
    const tailFrom = Math.max(window.start, until - 2 * period);
    const [stats, history, tail] = await Promise.all([
      fetchStatistics(hass, statIds, window.start, until, resolution),
      fetchHistory(hass, rawIds, window.start, until, textIds),
      guessedTail ? fetchHistory(hass, statIds, tailFrom, until) : Promise.resolve(new Map<string, Series>()),
    ]);

    for (const id of rawIds) entities.set(id, plain(id, history.get(id)));

    const late: { id: string; from: number }[] = [];
    for (const id of statIds) {
      const columns = toColumns(stats[id]);
      const info = meta.get(id) as StatisticsMeta;
      const data: EntityData = {
        entityId: id,
        raw: emptySeries(),
        stats: columns,
        meanType: isMeanType(info),
        statisticsUnit: info.statistics_unit_of_measurement ?? undefined,
      };
      entities.set(id, data);
      const n = columns.t.length;
      const from = n ? columns.t[n - 1] + period : window.start;
      if (from >= until) continue;
      const fetched = tail.get(id);
      if (guessedTail && fetched && from >= tailFrom) data.raw = sliceFrom(fetched, from);
      else late.push({ id, from });
    }

    if (late.length) {
      const from = Math.min(...late.map((item) => item.from));
      const extra = await fetchHistory(hass, late.map((item) => item.id), from, until);
      for (const item of late) {
        const series = extra.get(item.id);
        const data = entities.get(item.id);
        if (series && data) data.raw = sliceFrom(series, item.from);
      }
    }

    // 5-minute statistics are purged with raw history; hourly ones fill in.
    if (resolution === '5minute') {
      const missing = statIds.filter((id) => startsLate((entities.get(id) as EntityData).stats?.t ?? [], window.start));
      if (missing.length) {
        await fillStart(missing, (id) => (entities.get(id) as EntityData).stats?.t[0]);
      }
    }
  }

  const buckets = bucketsLoading ? await bucketsLoading : undefined;
  for (const id of ids) {
    const data = entities.get(id) as EntityData;
    if (data.raw.t.length || data.stats?.t.length || buckets?.entities.get(id)?.buckets.t.length) continue;
    data.error = hass.states[id] ? 'no_history' : 'not_found';
  }
  return { window, resolution, loadedAt: now, entities, buckets };
}

/** The points from `time` on, with the value at `time` as the first point. */
function sliceFrom(series: Series, time: number): Series {
  const from = Math.max(0, indexAtOrBefore(series.t, time));
  const t = series.t.slice(from);
  const v = series.v.slice(from);
  if (t.length && t[0] < time) t[0] = time;
  return { t, v };
}

/** Buckets that start before `end`. */
function sliceColumns(columns: StatColumns, end: number): StatColumns {
  let n = 0;
  while (n < columns.t.length && columns.t[n] < end) n++;
  return {
    t: columns.t.slice(0, n),
    mean: columns.mean.slice(0, n),
    min: columns.min.slice(0, n),
    max: columns.max.slice(0, n),
    state: columns.state.slice(0, n),
  };
}

function concatColumns(a: StatColumns, b: StatColumns): StatColumns {
  return {
    t: a.t.concat(b.t),
    mean: a.mean.concat(b.mean),
    min: a.min.concat(b.min),
    max: a.max.concat(b.max),
    state: a.state.concat(b.state),
  };
}

/**
 * The series one card row draws: statistics (if any) followed by raw history.
 * The entity's own statistic wins; the card-wide one applies where it fits, so
 * meters keep their reading whatever the card asks for.
 */
export function seriesFor(row: EntityConfig, data: LoadedData, cardStatistic?: StatisticKind): Series {
  const entity = data.entities.get(row.entity);
  if (!entity) return emptySeries();
  if (!entity.stats) return entity.raw;
  const fitting = !entity.meanType ? 'state' : cardStatistic && cardStatistic !== 'state' ? cardStatistic : 'mean';
  const kind = row.statistic ?? fitting;
  const base: Series = { t: entity.stats.t, v: entity.stats[kind] };
  if (kind === 'mean') {
    base.min = entity.stats.min;
    base.max = entity.stats.max;
  }
  return concatSeries(base, entity.raw, kind === 'mean');
}

/** Where a row's raw history starts: everywhere for raw data, after the last bucket with statistics. */
export function rawFrom(row: EntityConfig, data: LoadedData): number {
  const stats = data.entities.get(row.entity)?.stats;
  if (!stats?.t.length) return Number.NEGATIVE_INFINITY;
  return stats.t[stats.t.length - 1] + 1;
}

/** True when loaded data already covers `window` at the resolution it needs (zooming in). */
export function canReuse(
  data: LoadedData,
  window: TimeWindow,
  now: number,
  settings: DataSettings,
  rawSince?: number,
  bucketPeriod?: BucketPeriod,
): boolean {
  if (chooseResolution(window, settings, rawSince) !== data.resolution) return false;
  if (bucketPeriod !== data.buckets?.period) return false;
  if (window.start < data.window.start) return false;
  if (window.end <= data.window.end) return true;
  // A live window keeps growing with appended states.
  const wasLive = data.window.end >= data.loadedAt - MINUTE;
  return wasLive && window.end <= now + MINUTE;
}
