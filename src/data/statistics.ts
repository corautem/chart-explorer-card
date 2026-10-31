import type { HomeAssistant } from '../ha-types';
import type { Resolution, StatColumns } from './types';

export interface StatisticsMeta {
  statistic_id: string;
  has_mean?: boolean;
  has_sum?: boolean;
  /** Newer Home Assistant releases: 0 none, 1 arithmetic, 2 circular. */
  mean_type?: number;
  statistics_unit_of_measurement?: string | null;
}

export interface StatisticsRow {
  start: number | string;
  end?: number | string;
  change?: number | null;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  state?: number | null;
}

export type StatisticsResponse = Record<string, StatisticsRow[] | undefined>;

export function isMeanType(meta: StatisticsMeta): boolean {
  return Boolean(meta.has_mean) || (meta.mean_type ?? 0) > 0;
}

export async function fetchStatisticsMeta(
  hass: HomeAssistant,
  ids: string[],
): Promise<Map<string, StatisticsMeta>> {
  if (!ids.length) return new Map();
  const list = await hass.callWS<StatisticsMeta[]>({
    type: 'recorder/get_statistics_metadata',
    statistic_ids: ids,
  });
  return new Map((list ?? []).map((meta) => [meta.statistic_id, meta]));
}

export type StatisticsPeriod = Exclude<Resolution, 'raw'> | 'month';

export async function fetchStatistics(
  hass: HomeAssistant,
  ids: string[],
  start: number,
  end: number,
  period: StatisticsPeriod,
  types: string[] = ['mean', 'min', 'max', 'state'],
): Promise<StatisticsResponse> {
  if (!ids.length || end <= start) return {};
  return hass.callWS<StatisticsResponse>({
    type: 'recorder/statistics_during_period',
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    statistic_ids: ids,
    period,
    types,
  });
}

export const num = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : NaN;

/** A row's time as milliseconds; Home Assistant sends numbers or ISO text. */
export function rowTime(value: number | string | undefined): number {
  if (value === undefined) return NaN;
  return typeof value === 'number' ? value : Date.parse(value);
}

export function toColumns(rows: StatisticsRow[] | undefined): StatColumns {
  const columns: StatColumns = { t: [], mean: [], min: [], max: [], state: [] };
  for (const row of rows ?? []) {
    const start = rowTime(row.start);
    if (!Number.isFinite(start)) continue;
    columns.t.push(start);
    columns.mean.push(num(row.mean));
    columns.min.push(num(row.min));
    columns.max.push(num(row.max));
    columns.state.push(num(row.state));
  }
  return columns;
}
