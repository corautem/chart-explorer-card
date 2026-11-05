import type { AttributeSource } from '../config';
import { indexAtOrAfter, indexAtOrBefore } from './series';

/** One value read from each item of an attribute's list, with the items' times. */
export interface AttributeSeries {
  t: number[];
  v: number[];
}

/** Keys that usually hold the time of each item, in the order they are tried. */
const TIME_KEYS = ['period_start', 'start', 'start_time', 'datetime', 'time', 'from', 'date'];

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

/** Milliseconds from an ISO time, or from epoch seconds or milliseconds. */
export function toTime(value: unknown): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string') {
    if (/^\d+(\.\d+)?$/.test(value.trim())) return toTime(Number(value));
    return Date.parse(value);
  }
  return NaN;
}

/**
 * The value key when none is set: the only numeric key besides the time, or
 * one named value or state. Several numbers and no such name leave it unset,
 * so a forecast never shows the wrong one of its estimates.
 */
function guessValueKey(item: Record<string, unknown>, timeKey: string | undefined): string | undefined {
  const numeric = Object.keys(item).filter(
    (key) => key !== timeKey && !TIME_KEYS.includes(key) && Number.isFinite(toNumber(item[key])),
  );
  if (numeric.length === 1) return numeric[0];
  return ['value', 'state'].find((key) => numeric.includes(key));
}

/**
 * Reads a list of `{ time, value }` items, `[time, value]` pairs, or a map of
 * times to values. Items without a time are skipped; a missing value leaves a
 * gap. The result is sorted by time, and a repeated time keeps its last item,
 * so every value read from the same list gets the same times.
 */
export function attributeSeries(raw: unknown, source: AttributeSource): AttributeSeries {
  const points: { t: number; v: number }[] = [];
  const add = (time: unknown, value: unknown) => {
    const t = toTime(time);
    if (Number.isFinite(t)) points.push({ t, v: toNumber(value) });
  };
  if (Array.isArray(raw)) {
    let timeKey = source.time;
    let valueKey = source.value;
    for (const item of raw) {
      if (Array.isArray(item)) {
        add(item[0], item[1]);
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        timeKey ??= TIME_KEYS.find((key) => key in record);
        valueKey ??= guessValueKey(record, timeKey);
        if (!timeKey) continue;
        add(record[timeKey], valueKey ? record[valueKey] : undefined);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [time, value] of Object.entries(raw as Record<string, unknown>)) add(time, value);
  }
  points.sort((a, b) => a.t - b.t);
  const out: AttributeSeries = { t: [], v: [] };
  for (const point of points) {
    const last = out.t.length - 1;
    if (last >= 0 && out.t[last] === point.t) {
      out.t.pop();
      out.v.pop();
    }
    out.t.push(point.t);
    out.v.push(point.v);
  }
  return out;
}

/** The part of a list inside [start, end], with one point either side so lines run to the edges. */
export function sliceSeries(series: AttributeSeries, start: number, end: number): AttributeSeries {
  const from = Math.max(0, indexAtOrBefore(series.t, start));
  const after = indexAtOrAfter(series.t, end);
  const to = after < 0 || after >= series.t.length ? series.t.length : after + 1;
  return { t: series.t.slice(from, to), v: series.v.slice(from, to) };
}

/** The name the editor gives the single value of a map of times or of [time, value] pairs. */
export const SINGLE_VALUE_KEY = 'value';

const looksLikeTime = (key: string) => /^\d{4}-\d{2}-\d{2}/.test(key) || /^\d{10}(\d{3})?$/.test(key);

/** A map of times to numbers, such as Predbat's results: { "2026-11-04T10:00:00+00:00": 1.2, ... }. */
function isTimeMap(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 3);
  return entries.length > 0 && entries.every(([key, value]) => looksLikeTime(key) && Number.isFinite(toNumber(value)));
}

/** A list of [time, value] pairs. */
function isPairList(raw: unknown): boolean {
  return Array.isArray(raw) && Array.isArray(raw[0]) && raw[0].length >= 2 && Number.isFinite(toTime(raw[0][0]));
}

/** One number per time, without keys of its own: a map of times or a list of pairs. */
export const isSingleValue = (raw: unknown) => isTimeMap(raw) || isPairList(raw);

/** Attributes of an entity that hold such a list (items, pairs or a map of times), for the editor to offer. */
export function listAttributes(attributes: Record<string, unknown> | undefined): string[] {
  return Object.entries(attributes ?? {})
    .filter(([, value]) => Boolean(firstItem(value)) || isSingleValue(value))
    .map(([key]) => key);
}

function firstItem(raw: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined;
}

/** The keys of the first item in an attribute's list. */
export function itemKeys(raw: unknown): string[] {
  const first = firstItem(raw);
  return first ? Object.keys(first) : [];
}

/**
 * The numbers that can be drawn: the keys holding numbers in the first item,
 * such as pv_estimate and pv_estimate10, or the one value of a map or pairs.
 */
export function numberKeys(raw: unknown): string[] {
  if (isSingleValue(raw)) return [SINGLE_VALUE_KEY];
  const first = firstItem(raw);
  if (!first) return [];
  return Object.keys(first).filter((key) => !TIME_KEYS.includes(key) && Number.isFinite(toNumber(first[key])));
}

/** Whether the time key in the items is one found automatically (a map or pairs carry their times). */
export function hasKnownTimeKey(raw: unknown): boolean {
  if (isSingleValue(raw)) return true;
  const first = firstItem(raw);
  return Boolean(first && TIME_KEYS.some((key) => key in first));
}

/** The value key picked automatically, when there is one. */
export function automaticValueKey(raw: unknown): string | undefined {
  if (isSingleValue(raw)) return SINGLE_VALUE_KEY;
  const first = firstItem(raw);
  return first ? guessValueKey(first, TIME_KEYS.find((key) => key in first)) : undefined;
}

/**
 * The unit of a list when none is set. A map of times or pairs (a planner's
 * results) holds the entity's own quantity, so it takes the entity's unit.
 * Forecast items kept by an energy sensor (Solcast's slots) hold power, so kWh suggests kW.
 */
export function suggestedListUnit(entityUnit: unknown, raw?: unknown): string {
  if (raw !== undefined && isSingleValue(raw)) return entityUnit === undefined || entityUnit === null ? '' : String(entityUnit);
  return ({ Wh: 'W', kWh: 'kW', MWh: 'MW' } as Record<string, string>)[String(entityUnit)] ?? '';
}

/** Whether an attribute holds a list (items, pairs or a map of times) rather than a single value. */
export function isListValue(raw: unknown): boolean {
  return Array.isArray(raw) || (Boolean(raw) && typeof raw === 'object');
}

/** Attributes that hold a single number, such as a threshold, whose recorded history can be drawn. */
export function numberAttributes(attributes: Record<string, unknown> | undefined): string[] {
  return Object.entries(attributes ?? {})
    .filter(([key, value]) => key !== 'supported_features' && (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))))
    .map(([key]) => key);
}
