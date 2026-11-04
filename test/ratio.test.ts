import { describe, expect, it } from 'vitest';
import { defaultMinDivisor, ratioPeriods, runningRatio, windowRatio, type RatioPart } from '../src/data/ratio';
import { normalizeConfig } from '../src/config';
import { placeBars } from '../src/chart/timeseries';
import { automaticValueKey, hasKnownTimeKey, listAttributes, numberKeys, SINGLE_VALUE_KEY } from '../src/data/attribute';
import { inCommonUnits } from '../src/units';
import { attributeSeries } from '../src/data/attribute';
import { entityFromForm, entitySchema, entityToForm } from '../src/editor/schema';

const DAY = 86_400_000;
const t = [0, DAY, 2 * DAY];
const end = [DAY, 2 * DAY, 3 * DAY];
const part = (id: string, change: number[], unit: string, meter = true, found = true): RatioPart => ({ id, change, unit, meter, found });

describe('ratios per period', () => {
  it('divides each period\'s rise, converting Wh into kWh', () => {
    const ratio = ratioPeriods(t, end, [part('sensor.heat', [30, 20, 10], 'kWh')], [part('sensor.electricity', [10_000, 5_000, 4_000], 'Wh')]);
    expect(ratio.v).toEqual([3, 4, 2.5]);
    expect(ratio.unit).toBe('');
  });

  it('adds meters on each side before dividing', () => {
    const ratio = ratioPeriods(
      t,
      end,
      [part('sensor.heat_heating', [30, 20, 10], 'kWh'), part('sensor.heat_water', [6, 4, 2], 'kWh')],
      [part('sensor.el_heating', [10_000, 5_000, 4_000], 'Wh'), part('sensor.el_water', [2, 1, 1], 'kWh')],
    );
    expect(ratio.v).toEqual([36 / 12, 24 / 6, 12 / 5]);
  });

  it('gives the window ratio as a ratio of sums, not the mean of the periods', () => {
    const ratio = ratioPeriods(t, end, [part('h', [30, 2, 10], 'kWh')], [part('e', [10, 1, 5], 'kWh')]);
    expect(ratio.v).toEqual([3, 2, 2]);
    const window = windowRatio(ratio, 0, 3 * DAY);
    expect(window).toBeCloseTo(42 / 16);
    expect(window).not.toBeCloseTo((3 + 2 + 2) / 3);
    expect(windowRatio(ratio, DAY, 2 * DAY)).toBe(2);
  });

  it('leaves a period empty when the divisor rose less than the minimum', () => {
    const ratio = ratioPeriods(t, end, [part('h', [30, 0.5, 10], 'kWh')], [part('e', [10_000, 20, 0], 'Wh')]);
    expect(ratio.min).toBe(50);
    expect(ratio.v[0]).toBe(3);
    expect(Number.isNaN(ratio.v[1])).toBe(true);
    expect(Number.isNaN(ratio.v[2])).toBe(true);
    const strict = ratioPeriods(t, end, [part('h', [30, 0.5, 10], 'kWh')], [part('e', [10_000, 20, 0], 'Wh')], 0);
    expect(strict.v[1]).toBe(25);
    expect(defaultMinDivisor('kWh')).toBe(0.05);
    expect(defaultMinDivisor('m³')).toBe(0);
  });

  it('keeps the sign of a meter that dips, such as heat during a defrost', () => {
    const ratio = ratioPeriods(t, end, [part('h', [-0.2, 3, 3], 'kWh')], [part('e', [0.1, 1, 1], 'kWh')]);
    expect(ratio.v[0]).toBeCloseTo(-2);
    expect(windowRatio(ratio, 0, 3 * DAY)).toBeCloseTo(5.8 / 2.1);
  });

  it('names units of different families, such as kWh per m³', () => {
    expect(ratioPeriods(t, end, [part('h', [10, 10, 10], 'kWh')], [part('g', [1, 2, 4], 'm³')]).unit).toBe('kWh/m³');
  });

  it('counts a quiet meter as not having moved while another part has', () => {
    const ratio = ratioPeriods(t, end, [part('h', [30, 20, 10], 'kWh'), part('w', [NaN, 4, NaN], 'kWh')], [part('e', [10, 6, NaN], 'kWh')]);
    expect(ratio.num).toEqual([30, 24, 10]);
    expect(Number.isNaN(ratio.v[2])).toBe(true);
  });

  it('runs the ratio from the window start ("so far")', () => {
    const ratio = ratioPeriods(t, end, [part('h', [30, 2, 10], 'kWh')], [part('e', [10, 1, 5], 'kWh')]);
    expect(runningRatio(ratio, 0, 3 * DAY)).toEqual([3, 32 / 11, 42 / 16]);
    const late = runningRatio(ratio, DAY, 2 * DAY);
    expect(Number.isNaN(late[0])).toBe(true);
    expect(late[1]).toBe(2);
  });

  it('reports a missing meter or a measurement', () => {
    expect(ratioPeriods(t, end, [part('sensor.heat', [1, 1, 1], 'kWh')], [part('sensor.power', [1, 1, 1], 'W', false)]).problem).toEqual({
      id: 'sensor.power',
      reason: 'measurement',
    });
    expect(ratioPeriods(t, end, [part('sensor.gone', [], '', false, false)], [part('sensor.e', [1, 1, 1], 'kWh')]).problem?.reason).toBe('not_found');
    const broken = ratioPeriods(t, end, [part('sensor.heat', [1, 1, 1], 'kWh')], [part('sensor.power', [NaN, NaN, 5], 'W', false)]);
    expect(broken.v.every((value) => Number.isNaN(value))).toBe(true);
    expect(Number.isNaN(windowRatio(broken, 0, 3 * DAY))).toBe(true);
  });
});

describe('ratio options', () => {
  it('accepts one divisor or a list, meters to add and a minimum', () => {
    const [row] = normalizeConfig({
      entities: [{ entity: 'sensor.heat_space', add: ['sensor.heat_water'], divide_by: ['sensor.el_space', 'sensor.el_water'], min_divisor: 0.2 }],
    }).entities;
    expect(row.ratio).toEqual({ add: ['sensor.heat_water'], divideBy: ['sensor.el_space', 'sensor.el_water'], minDivisor: 0.2 });
    const [single] = normalizeConfig({ entities: [{ entity: 'sensor.heat', divide_by: 'sensor.el' }] }).entities;
    expect(single.ratio).toEqual({ add: [], divideBy: ['sensor.el'], minDivisor: undefined });
  });

  it('explains wrong ratio settings', () => {
    const config = (entity: Record<string, unknown>) => () => normalizeConfig({ entities: [{ entity: 'sensor.heat', ...entity } as never] });
    expect(config({ divide_by: 'not an id' })).toThrow(/divide_by must be an entity ID/);
    expect(config({ add: 'sensor.water' })).toThrow(/need divide_by/);
    expect(config({ divide_by: 'sensor.el', min_divisor: -1 })).toThrow(/zero or more/);
    expect(config({ divide_by: 'sensor.el', attribute: 'results' })).toThrow(/not on lists/);
  });

  it('stands ratio bars beside a stack instead of piling them on it', () => {
    const rows = [
      { t: [0], end: [10], v: [2] },
      { t: [0], end: [10], v: [3] },
      { t: [0], end: [10], v: [4] },
    ];
    const [a, b, ratio] = placeBars(rows, [true, true, false]);
    expect(b[0].low).toBe(2);
    expect(a[0].start).toBe(b[0].start);
    expect(ratio[0].start).toBeGreaterThanOrEqual(a[0].end);
    expect(ratio[0].low).toBe(0);
  });
});

describe('the ratio fields of the editor', () => {
  const blue = '#1f77b4';

  it('round-trips divide_by, add and min_divisor', () => {
    const original = { entity: 'sensor.heat_space', add: 'sensor.heat_water', divide_by: ['sensor.el_space', 'sensor.el_water'], min_divisor: 0.2 };
    const form = entityToForm(original, blue);
    expect(form.divide_by).toEqual(['sensor.el_space', 'sensor.el_water']);
    expect(form.add).toEqual(['sensor.heat_water']);
    expect(entityFromForm(form, original, blue)).toEqual(original);
    expect(entityFromForm({ ...form, divide_by: [] }, original, blue)).toBe('sensor.heat_space');
  });

  it('shows the meters to add and the minimum only for a ratio, without the long-window statistic', () => {
    const names = (schema: unknown[]) => JSON.stringify(schema);
    const plain = names(entitySchema('bar', 'bar'));
    expect(plain).toContain('"name":"divide_by"');
    expect(plain).not.toContain('"name":"add"');
    const ratio = names(entitySchema('bar', 'bar', [], undefined, true));
    expect(ratio).toContain('"name":"add"');
    expect(ratio).toContain('"name":"min_divisor"');
    expect(ratio).not.toContain('"name":"statistic"');
    expect(ratio).not.toContain('Timeline strip');
  });
});

describe('maps of times in the editor', () => {
  // The shape of Predbat's results: ISO times mapped to numbers (made-up values).
  const results = { '2026-11-04T10:00:00+00:00': 1.2, '2026-11-04T10:30:00+00:00': 1.6 };

  it('offers a map of times as a list with one value', () => {
    expect(listAttributes({ friendly_name: 'Plan', results, total: 4 })).toEqual(['results']);
    expect(numberKeys(results)).toEqual([SINGLE_VALUE_KEY]);
    expect(automaticValueKey(results)).toBe(SINGLE_VALUE_KEY);
    expect(hasKnownTimeKey(results)).toBe(true);
    expect(attributeSeries(results, { name: 'results', value: SINGLE_VALUE_KEY }).v).toEqual([1.2, 1.6]);
  });

  it('offers lists of [time, value] pairs, and not other objects', () => {
    expect(listAttributes({ pairs: [['2026-11-04T10:00:00Z', 1]], settings: { mode: 'eco', level: 3 } })).toEqual(['pairs']);
  });
});

describe('multiply and pies in one unit', () => {
  it('accepts multiply, drops 1, and explains 0 or text', () => {
    const rows = normalizeConfig({ entities: [{ entity: 'sensor.charger', multiply: 1000, unit: 'W' }, { entity: 'sensor.grid', multiply: -1 }, { entity: 'sensor.x', multiply: 1 }] }).entities;
    expect(rows.map((row) => row.multiply)).toEqual([1000, -1, undefined]);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', multiply: 0 }] })).toThrow(/other than 0/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', multiply: 'lots' as never }] })).toThrow(/other than 0/);
  });

  it('saves multiply from the editor only when it changes the values', () => {
    const blue = '#1f77b4';
    const original = { entity: 'sensor.charger', multiply: 1000, unit: 'W' };
    expect(entityFromForm(entityToForm(original, blue), original, blue)).toEqual(original);
    expect(entityFromForm({ ...entityToForm(original, blue), multiply: 1 }, original, blue)).toEqual({ entity: 'sensor.charger', unit: 'W' });
    expect(JSON.stringify(entitySchema('line', 'line'))).toContain('"name":"multiply"');
  });

  it('compares W and kW in one unit for pie shares, leaving other units alone', () => {
    // A car charger at 7.4 kW beside a heater at 2000 W and a kettle at 0.5 kW.
    expect(inCommonUnits([{ value: 2000, unit: 'W' }, { value: 7.4, unit: 'kW' }, { value: 0.5, unit: 'kW' }])).toEqual([2000, 7400, 500]);
    expect(inCommonUnits([{ value: 3, unit: 'kWh' }, { value: 500, unit: 'Wh' }, { value: 20, unit: '°C' }])).toEqual([3, 0.5, 20]);
  });
});

