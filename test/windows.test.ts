import { describe, expect, it } from 'vitest';
import {
  followsCalendar,
  labelEndIsInclusive,
  nowSpec,
  parseRangeItem,
  parseRangeSpec,
  parseSpan,
  resolveWindow,
  slides,
  sortRangeItems,
  stepSpec,
  type RangeSpec,
} from '../src/time/range';
import { buttonLabel, menuLabel } from '../src/localize';
import { chooseResolution } from '../src/data/resolution';
import { normalizeConfig } from '../src/config';
import { parseAttributeHistory } from '../src/data/history';
import { entityKey, mergeShifted } from '../src/data/loader';
import { hasTextStates } from '../src/rows';
import { isListValue, numberAttributes, suggestedListUnit } from '../src/data/attribute';
import { entityFromForm, entitySchema, entityToForm } from '../src/editor/schema';
import type { HassEntity } from '../src/ha-types';
import type { LoadedData } from '../src/data/types';

const HOUR = 3_600_000;
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('windows across the past and the future', () => {
  it('reads a span as a start and a length', () => {
    expect(parseSpan('-12h+60h')).toMatchObject({ id: '-12h+60h', start: { kind: 'offset' }, length: { amount: 60, unit: 'h' } });
    expect(parseSpan(' today + 72h ')?.id).toBe('today+72h');
    expect(parseSpan('tomorrow+2d')?.start).toEqual({ kind: 'preset', id: 'tomorrow' });
    expect(parseSpan('soon+2d')).toBeUndefined();
    expect(parseSpan('+48h')).toBeUndefined();
    expect(parseRangeItem('-1h+48h')?.kind).toBe('span');
    expect(parseRangeItem('+48h')?.kind).toBe('length');
  });

  it('spans from some time ago into the future, sliding with the clock', () => {
    const now = local(2026, 11, 5, 14);
    const spec = parseRangeSpec('-12h+60h') as RangeSpec;
    expect(resolveWindow(spec, now, 1)).toEqual({ start: now - 12 * HOUR, end: now + 48 * HOUR });
    expect(slides(spec)).toBe(true);
    expect(followsCalendar(spec)).toBe(false);
    expect(labelEndIsInclusive(spec)).toBe(false);
  });

  it('spans whole days from midnight, ending at midnight across a clock change', () => {
    // 25 October 2026 has 25 hours in Europe, 1 November in America; Sydney changes on 4 October.
    for (const day of [local(2026, 10, 24, 15), local(2026, 10, 31, 15), local(2026, 10, 3, 15)]) {
      const today = new Date(day);
      const spec = parseRangeSpec('today+72h') as RangeSpec;
      const w = resolveWindow(spec, day, 1);
      expect(w.start).toBe(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime());
      expect(w.end).toBe(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3).getTime());
    }
    const spec = parseRangeSpec('today+48h') as RangeSpec;
    expect(followsCalendar(spec)).toBe(true);
    expect(labelEndIsInclusive(spec)).toBe(true);
  });

  it('steps by the window length and comes back live', () => {
    const now = local(2026, 11, 5, 14);
    const spec = parseRangeSpec('-12h+60h') as RangeSpec;
    const back = stepSpec(spec, -1, now, 1);
    expect(back.kind).toBe('fixed');
    expect(resolveWindow(back, now, 1)).toEqual({ start: now - 72 * HOUR, end: now - 12 * HOUR });
    expect(stepSpec(back, 1, now, 1)).toEqual(spec);
    expect(nowSpec(back)).toEqual(spec);
    expect(nowSpec(spec)).toEqual(spec);
  });

  it('names spans in the menu and on buttons', () => {
    const name = (id: string) => menuLabel(parseRangeItem(id) as never);
    const button = (id: string) => buttonLabel(parseRangeItem(id) as never);
    expect(name('-12h+60h')).toBe('12 hours ago to 2 days ahead');
    expect(name('-1h+48h')).toBe('1 hour ago to 47 hours ahead');
    expect(name('-36h+12h')).toBe('36 hours ago to 1 day ago');
    expect(name('today+72h')).toBe('Today for 3 days');
    expect(name('today+36h')).toBe('Today for 36 hours');
    expect(button('-12h+60h')).toBe('-12h…+2d');
    expect(button('today+72h')).toBe('Today +3d');
  });

  it('sorts spans after the lengths and before the presets', () => {
    const ids = sortRangeItems(['today', '-12h+60h', '24h', '+48h'].map((id) => parseRangeItem(id) as never)).map(
      (item: { kind: string; id?: string; span?: { id: string }; quick?: { id: string } }) => item.id ?? item.span?.id ?? item.quick?.id,
    );
    expect(ids).toEqual(['24h', '+48h', '-12h+60h', 'today']);
  });

  it('chooses the data by the part of the window up to now', () => {
    const settings = normalizeConfig({ entities: ['sensor.a'] }).data;
    const now = local(2026, 11, 5, 14);
    // 60 hours long, but only 12 hours of it have history: raw history fits.
    expect(chooseResolution({ start: now - 12 * HOUR, end: now + 48 * HOUR }, settings, undefined, now)).toBe('raw');
    expect(chooseResolution({ start: now - 12 * HOUR, end: now + 48 * HOUR }, settings)).toBe('5minute');
  });

  it('accepts spans in default_range, quick_ranges and presets, and explains a wrong one', () => {
    const config = normalizeConfig({ entities: ['sensor.a'], default_range: '-12h+60h', quick_ranges: ['6h', 'today+48h'], presets: ['-36h+48h'] });
    expect(config.defaultRange).toMatchObject({ kind: 'span' });
    expect(() => normalizeConfig({ entities: ['sensor.a'], default_range: 'today+lots' })).toThrow(/span such as -12h\+60h/);
  });
});

describe('time shift, values only and attribute history', () => {
  it('reads a signed time shift, and refuses it on a ratio', () => {
    const rows = normalizeConfig({
      entities: [{ entity: 'sensor.a', time_shift: '-8h' }, { entity: 'sensor.b', time_shift: '+30m' }, { entity: 'sensor.c', time_shift: '0h' }],
    }).entities;
    expect(rows.map((row) => row.timeShift)).toEqual([-8 * HOUR, 1_800_000, undefined]);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', time_shift: 'eight hours' }] })).toThrow(/with a sign/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', time_shift: '-1h', divide_by: 'sensor.b' }] })).toThrow(/divide_by/);
  });

  it('keeps entities in the chart unless show_in_chart is false', () => {
    const rows = normalizeConfig({ entities: ['sensor.a', { entity: 'sensor.b', show_in_chart: false }] }).entities;
    expect(rows.map((row) => row.showInChart)).toEqual([true, false]);
  });

  it('keys shifted data apart, and moves it back onto the window shown', () => {
    expect(entityKey({ entity: 'sensor.a' })).toBe('sensor.a');
    expect(entityKey({ entity: 'sensor.a', timeShift: -8 * HOUR })).toBe(`sensor.a@${-8 * HOUR}`);
    const main: LoadedData = { window: { start: 0, end: 10 * HOUR }, resolution: 'raw', loadedAt: 0, entities: new Map() };
    const shifted: LoadedData = {
      window: { start: -8 * HOUR, end: 2 * HOUR },
      resolution: 'raw',
      loadedAt: 0,
      entities: new Map([['sensor.a', { entityId: 'sensor.a', raw: { t: [-8 * HOUR, 0], v: [1, 2] }, meanType: true }]]),
      attributes: new Map([['sensor.a|threshold', { t: [-7 * HOUR], v: [5] }]]),
    };
    mergeShifted(main, shifted, -8 * HOUR);
    expect(main.entities.get(`sensor.a@${-8 * HOUR}`)?.raw.t).toEqual([0, 8 * HOUR]);
    expect(main.attributes?.get(`sensor.a@${-8 * HOUR}|threshold`)?.t).toEqual([HOUR]);
  });

  it('reads an attribute\'s history from rows with attributes, carrying them forward', () => {
    const rows = [
      { s: '24.6', lu: 1000, a: { threshold: 12.5, rates: {} } },
      { s: '24.6', lu: 1600 },
      { s: '7.5', lu: 2200, a: { threshold: 12.5 } },
      { s: '7.5', lu: 2800, a: { threshold: '14' } },
    ];
    const series = parseAttributeHistory({ 'planner.rate': rows }, [{ id: 'planner.rate', name: 'threshold' }], 0).get('planner.rate|threshold');
    expect(series).toEqual({ t: [1_000_000, 2_800_000], v: [12.5, 14] });
  });

  it('judges an add-on\'s own domain by its unit and state, keeping on/off domains as text', () => {
    const state = (entity_id: string, value: string, attributes: Record<string, unknown> = {}) =>
      ({ entity_id, state: value, attributes, last_changed: '', last_updated: '' }) as HassEntity;
    expect(hasTextStates(state('planner.battery_forecast', '4.2', { unit_of_measurement: 'kWh' }))).toBe(false);
    expect(hasTextStates(state('planner.mode', 'charging'))).toBe(true);
    expect(hasTextStates(state('binary_sensor.door', 'off'))).toBe(true);
  });

  it('tells single numbers from lists, and gives maps the entity\'s unit', () => {
    expect(isListValue(12.5)).toBe(false);
    expect(isListValue('12.5')).toBe(false);
    expect(isListValue({ '2026-11-05T10:00:00Z': 1 })).toBe(true);
    expect(numberAttributes({ threshold: 12.5, total: '4', results: {}, friendly_name: 'Rate', supported_features: 3 })).toEqual(['threshold', 'total']);
    expect(suggestedListUnit('kWh', { '2026-11-05T10:00:00Z': 1 })).toBe('kWh');
    expect(suggestedListUnit('kWh', [{ period_start: '2026-11-05T10:00:00Z', pv_estimate: 1 }])).toBe('kW');
  });
});

describe('the new entity fields in the editor', () => {
  const blue = '#1f77b4';

  it('round-trips time_shift and show_in_chart', () => {
    const original = { entity: 'planner.forecast_8h_ago', time_shift: '-8h', show_in_chart: false };
    expect(entityFromForm(entityToForm(original, blue), original, blue)).toEqual(original);
    expect(entityFromForm(entityToForm('sensor.a', blue), 'sensor.a', blue)).toBe('sensor.a');
  });

  it('offers single-number attributes and draws them like an entity', () => {
    const names = (schema: unknown[]) => JSON.stringify(schema);
    const list = { attributes: ['rates'], numbers: ['threshold'], keys: [], chosen: 'threshold', history: true };
    const schema = names(entitySchema('line', 'line', [], list));
    expect(schema).toContain('Attribute: threshold (its history)');
    expect(schema).toContain('"name":"line_style"');
    expect(schema).toContain('"name":"time_shift"');
    expect(schema).toContain('"name":"show_in_chart"');
    expect(names(entitySchema('bar', 'bar', [], undefined, true))).not.toContain('"name":"time_shift"');
  });
});
