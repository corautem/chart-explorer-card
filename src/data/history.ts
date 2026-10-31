import type { HomeAssistant } from '../ha-types';
import { stateToNumber } from '../number';
import type { Series } from './types';

/** Home Assistant's compressed state rows: state, last changed and last updated (seconds). */
interface CompressedState {
  s: string;
  lu: number;
  lc?: number;
}

export type HistoryResponse = Record<string, CompressedState[] | undefined>;

/**
 * Raw state history for a time range, with the same compact options as Home
 * Assistant's own history graph. The first row of each entity is its state at
 * `start`, so lines begin at the left edge.
 */
export async function fetchHistory(
  hass: HomeAssistant,
  entityIds: string[],
  start: number,
  end: number,
  textIds?: ReadonlySet<string>,
): Promise<Map<string, Series>> {
  if (!entityIds.length || end <= start) {
    return new Map(entityIds.map((id) => [id, { t: [], v: [] }]));
  }
  const response = await hass.callWS<HistoryResponse>({
    type: 'history/history_during_period',
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    entity_ids: entityIds,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: true,
  });
  return parseHistory(response, entityIds, start, textIds);
}

/** Rows to series; entities in `textIds` keep their state text as well. */
export function parseHistory(
  response: HistoryResponse | undefined,
  entityIds: string[],
  start: number,
  textIds?: ReadonlySet<string>,
): Map<string, Series> {
  const result = new Map<string, Series>();
  for (const id of entityIds) {
    const t: number[] = [];
    const v: number[] = [];
    const s: string[] | undefined = textIds?.has(id) ? [] : undefined;
    for (const row of response?.[id] ?? []) {
      const time = Math.max(start, Math.round((row.lc ?? row.lu) * 1000));
      const value = stateToNumber(row.s);
      const n = t.length;
      if (n && time < t[n - 1]) continue;
      if (n && time === t[n - 1]) {
        v[n - 1] = value;
        if (s) s[n - 1] = row.s;
        continue;
      }
      t.push(time);
      v.push(value);
      s?.push(row.s);
    }
    result.set(id, s ? { t, v, s } : { t, v });
  }
  return result;
}
