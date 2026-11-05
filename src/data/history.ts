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

/** Compressed rows with their attributes, as Home Assistant sends them when asked for attributes. */
interface StateWithAttributes extends CompressedState {
  a?: Record<string, unknown>;
}

/** A numeric attribute whose recorded history is wanted, such as a planner's threshold. */
export interface AttributeRequest {
  id: string;
  name: string;
}

export const attributeKey = (id: string, name: string) => `${id}|${name}`;

/**
 * The recorded history of numeric attributes. Home Assistant sends attributes
 * only as whole state objects, every attribute with every change, so callers
 * keep the range short. Statistics do not cover attributes.
 */
export async function fetchAttributeHistory(
  hass: HomeAssistant,
  requests: AttributeRequest[],
  start: number,
  end: number,
): Promise<Map<string, Series>> {
  const ids = [...new Set(requests.map((request) => request.id))];
  if (!ids.length || end <= start) {
    return new Map(requests.map((request) => [attributeKey(request.id, request.name), { t: [], v: [] }]));
  }
  const response = await hass.callWS<Record<string, StateWithAttributes[] | undefined>>({
    type: 'history/history_during_period',
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    entity_ids: ids,
    minimal_response: false,
    no_attributes: false,
    // An attribute can change while the state stays the same.
    significant_changes_only: false,
  });
  return parseAttributeHistory(response, requests, start);
}

/** Rows to one series per attribute: a point where its value changes, timed by the row's last update. */
export function parseAttributeHistory(
  response: Record<string, StateWithAttributes[] | undefined> | undefined,
  requests: AttributeRequest[],
  start: number,
): Map<string, Series> {
  const result = new Map<string, Series>();
  for (const { id, name } of requests) {
    const t: number[] = [];
    const v: number[] = [];
    let attributes: Record<string, unknown> | undefined;
    for (const row of response?.[id] ?? []) {
      // A row without attributes keeps the last ones sent.
      attributes = row.a ?? attributes;
      const raw = attributes?.[name];
      const value = typeof raw === 'number' ? raw : stateToNumber(raw === undefined || raw === null ? '' : String(raw));
      const time = Math.max(start, Math.round(row.lu * 1000));
      const n = t.length;
      if (n && time < t[n - 1]) continue;
      if (n && (value === v[n - 1] || (Number.isNaN(value) && Number.isNaN(v[n - 1])))) continue;
      if (n && time === t[n - 1]) {
        v[n - 1] = value;
        continue;
      }
      t.push(time);
      v.push(value);
    }
    result.set(attributeKey(id, name), { t, v });
  }
  return result;
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
