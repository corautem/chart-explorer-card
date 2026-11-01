import { describe, expect, it } from 'vitest';
import {
  attributeSeries,
  automaticValueKey,
  hasKnownTimeKey,
  itemKeys,
  listAttributes,
  numberKeys,
  sliceSeries,
  suggestedListUnit,
  toTime,
} from '../src/data/attribute';
import { normalizeConfig } from '../src/config';
import { shadeColor } from '../src/chart/theme';
import { paddedBounds } from '../src/chart/timeseries';
import { NumberFormatter } from '../src/number';
import { sameFamily, unitFactor } from '../src/units';
import {
  attributeValues,
  attributeValuesSchema,
  entityFromForm,
  entitySchema,
  entityToForm,
  valueColor,
  valuesFromForm,
  valuesToForm,
} from '../src/editor/schema';

const at = (time: string) => Date.parse(time);

// The shape Solcast and Predbat use for detailedForecast: half-hour slots in kW.
const forecast = [
  { period_start: '2026-10-31T10:30:00+00:00', pv_estimate: 2.1, pv_estimate10: 1.2, pv_estimate90: 2.6 },
  { period_start: '2026-10-31T10:00:00+00:00', pv_estimate: 1.8, pv_estimate10: 0.9, pv_estimate90: 2.2 },
  { period_start: '2026-10-31T11:00:00+00:00', pv_estimate: 2.4, pv_estimate10: 1.5, pv_estimate90: 2.9 },
];

describe('lists from attributes', () => {
  it('reads one value from each item, sorted by time', () => {
    const list = attributeSeries(forecast, { name: 'detailedForecast', value: 'pv_estimate10' });
    expect(list.t).toEqual([at('2026-10-31T10:00:00Z'), at('2026-10-31T10:30:00Z'), at('2026-10-31T11:00:00Z')]);
    expect(list.v).toEqual([0.9, 1.2, 1.5]);
  });

  it('finds the time key, and the value when it is the only number', () => {
    const prices = [
      { start: '2026-10-31T10:00:00Z', end: '2026-10-31T10:30:00Z', value: 0.25 },
      { start: '2026-10-31T10:30:00Z', end: '2026-10-31T11:00:00Z', value: '0.31' },
    ];
    expect(attributeSeries(prices, { name: 'rates' }).v).toEqual([0.25, 0.31]);
    expect(automaticValueKey(prices)).toBe('value');
    expect(automaticValueKey(forecast)).toBeUndefined();
  });

  it('leaves the value unset rather than guess between several numbers', () => {
    const list = attributeSeries(forecast, { name: 'detailedForecast' });
    expect(list.t).toHaveLength(3);
    expect(list.v.every((value) => Number.isNaN(value))).toBe(true);
  });

  it('reads [time, value] pairs and maps of times to values, in seconds or milliseconds', () => {
    expect(attributeSeries([[1_790_000_000, 1], [1_790_000_000_000 + 1800_000, 2]], { name: 'a' }).t).toEqual([
      1_790_000_000_000,
      1_790_001_800_000,
    ]);
    expect(attributeSeries({ '2026-10-31T10:00:00Z': 5, '2026-10-31T09:00:00Z': 4 }, { name: 'watts' }).v).toEqual([4, 5]);
    expect(toTime('1790000000')).toBe(1_790_000_000_000);
  });

  it('skips items without a time, keeps the last of a repeated time, and leaves gaps for missing values', () => {
    const list = attributeSeries(
      [
        { start: 'not a time', value: 1 },
        { start: '2026-10-31T10:00:00Z', value: 2 },
        { start: '2026-10-31T10:00:00Z', value: 3 },
        { start: '2026-10-31T10:30:00Z', value: null },
      ],
      { name: 'a', value: 'value' },
    );
    expect(list.v[0]).toBe(3);
    expect(Number.isNaN(list.v[1])).toBe(true);
    expect(list.t).toHaveLength(2);
    expect(attributeSeries(undefined, { name: 'a' }).t).toEqual([]);
  });

  it('keeps one point either side of the window', () => {
    const list = attributeSeries(forecast, { name: 'f', value: 'pv_estimate' });
    expect(sliceSeries(list, at('2026-10-31T10:10:00Z'), at('2026-10-31T10:40:00Z')).v).toEqual([1.8, 2.1, 2.4]);
    expect(sliceSeries(list, at('2026-10-31T10:30:00Z'), at('2026-10-31T10:30:00Z')).v).toEqual([2.1]);
  });

  it('offers the list attributes, their numbers and their time key', () => {
    expect(listAttributes({ friendly_name: 'PV', total: 11, detailedForecast: forecast, tags: ['a'] })).toEqual(['detailedForecast']);
    expect(itemKeys(forecast)).toEqual(['period_start', 'pv_estimate', 'pv_estimate10', 'pv_estimate90']);
    expect(numberKeys(forecast)).toEqual(['pv_estimate', 'pv_estimate10', 'pv_estimate90']);
    expect(hasKnownTimeKey(forecast)).toBe(true);
    expect(hasKnownTimeKey([{ moment: '2026-10-31T10:00:00Z', v: 1 }])).toBe(false);
  });

  it('suggests kW for a list kept by a kWh sensor, and nothing for other units', () => {
    expect(suggestedListUnit('kWh')).toBe('kW');
    expect(suggestedListUnit('Wh')).toBe('W');
    expect(suggestedListUnit('GBP/kWh')).toBe('');
    expect(suggestedListUnit(undefined)).toBe('');
  });
});

describe('values drawn from a list', () => {
  const config = (attribute: unknown, extra: Record<string, unknown> = {}) =>
    normalizeConfig({ entities: [{ entity: 'sensor.pv_forecast', attribute, ...extra } as never] }).entities;

  it('draws each value in the list as a row of its own', () => {
    const rows = config({
      name: 'detailedForecast',
      values: [
        { key: 'pv_estimate', name: 'Forecast' },
        { key: 'pv_estimate10', line_style: 'none', fill: 'zero', fill_opacity: 0.35 },
        { key: 'pv_estimate90', line_style: 'none', fill: 'pv_estimate10', show_in_header: false },
      ],
    });
    expect(rows.map((row) => row.key)).toEqual(['0:sensor.pv_forecast#0', '0:sensor.pv_forecast#1', '0:sensor.pv_forecast#2']);
    expect(rows.map((row) => row.attribute?.value)).toEqual(['pv_estimate', 'pv_estimate10', 'pv_estimate90']);
    expect(rows.map((row) => row.name)).toEqual(['Forecast', 'pv_estimate10', 'pv_estimate90']);
    expect(rows.map((row) => row.shade)).toEqual([0, 1, 2]);
    expect(rows[1]).toMatchObject({ lineStyle: 'none', fill: true, fillOpacity: 0.35 });
    expect(rows[2]).toMatchObject({ fill: false, fillTo: 'pv_estimate10', showInHeader: false });
  });

  it('reads the older value, low and high as a value with a range in its colour', () => {
    const rows = config({ name: 'detailedForecast', value: 'pv_estimate', low: 'pv_estimate10', high: 'pv_estimate90' }, { name: 'Forecast', line_style: 'dashed' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: '0:sensor.pv_forecast', name: 'Forecast', lineStyle: 'dashed', attribute: { value: 'pv_estimate' } });
    expect(rows[1]).toMatchObject({ lineStyle: 'none', fillTo: 'pv_estimate10', fillOpacity: 0.18, showInHeader: false, shade: 0, name: 'Forecast high' });
    expect(config('detailedForecast')).toHaveLength(1);
  });

  it('draws nothing when every value is switched off, and explains a value without a key', () => {
    expect(config({ name: 'detailedForecast', values: [] })).toEqual([]);
    expect(() => config({ name: 'detailedForecast', values: [{ name: 'x' }] })).toThrow(/key/);
    expect(() => config({ value: 'x' })).toThrow(/attribute/);
  });

  it('gives later values shades of the entity colour', () => {
    expect(shadeColor('#2a78d6', 0)).toBe('#2a78d6');
    expect(shadeColor('#2a78d6', 1)).not.toBe('#2a78d6');
    expect(shadeColor('#2a78d6', 1)).toBe(shadeColor('#2a78d6', 1));
    expect(valueColor('#2a78d6', 0)).toBe('#2a78d6');
  });
});

describe('line type none and fill opacity', () => {
  it('accepts line style none and a fill opacity, and explains a wrong opacity', () => {
    const [row] = normalizeConfig({ entities: [{ entity: 'sensor.a', line_style: 'none', fill: true, fill_opacity: 0.3 }] }).entities;
    expect(row).toMatchObject({ lineStyle: 'none', fillOpacity: 0.3 });
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', fill_opacity: 30 }] })).toThrow(/between 0 and 1/);
  });
});

describe('units on one scale', () => {
  it('converts W to kW and Wh to kWh, and leaves other units alone', () => {
    expect(unitFactor('W', 'kW')).toBe(0.001);
    expect(unitFactor('kW', 'W')).toBe(1000);
    expect(unitFactor('Wh', 'kWh')).toBe(0.001);
    expect(unitFactor('W', 'kWh')).toBe(1);
    expect(unitFactor('°C', 'kW')).toBe(1);
    expect(sameFamily('W', 'kW')).toBe(true);
    expect(sameFamily('W', 'Wh')).toBe(false);
  });

  it('gives a flat line at zero a scale from 0 to 1, and never writes -0', () => {
    const bounds = paddedBounds({ top: 0.05, bottom: 0.05 }, false);
    expect(bounds.min({ min: 0, max: 0 })).toBe(0);
    expect(bounds.max({ min: 0, max: 0 })).toBe(1);
    expect(bounds.min({ min: 20, max: 20 })).toBe(19);
    const numbers = new NumberFormatter({ language: 'en' });
    expect(numbers.compact(-0.04)).toBe('0');
    expect(numbers.format(-0.001, 0)).toBe('0');
    expect(numbers.format(-0.004)).toBe('0');
    expect(numbers.format(-0.5, 0)).not.toBe('0');
  });
});

describe('the values section of the editor', () => {
  const blue = '#1f77b4';
  const keys = ['pv_estimate', 'pv_estimate10', 'pv_estimate90'];

  it('turns the older forms into a values list', () => {
    expect(attributeValues({ entity: 'sensor.p', attribute: { name: 'f', value: 'pv_estimate', low: 'pv_estimate10', high: 'pv_estimate90' } })).toMatchObject([
      { key: 'pv_estimate' },
      { key: 'pv_estimate90', line_style: 'none', fill: 'pv_estimate10', show_in_header: false },
    ]);
    expect(attributeValues({ entity: 'sensor.p', attribute: 'rates' }, 'value')).toMatchObject([{ key: 'value' }]);
    expect(attributeValues({ entity: 'sensor.p', attribute: 'detailedForecast' })).toEqual([]);
  });

  it('round-trips a values list, saving only what differs from the defaults', () => {
    const values = [
      { key: 'pv_estimate', name: 'Forecast' },
      { key: 'pv_estimate90', line_style: 'none' as const, fill: 'pv_estimate10', fill_opacity: 0.2 },
    ];
    const form = valuesToForm(values, keys, blue);
    expect(form['on:pv_estimate10']).toBe(false);
    expect(form['fill:pv_estimate90']).toBe('pv_estimate10');
    expect(valuesFromForm(form, keys, values, blue)).toEqual(values);
  });

  it('adds a switched-on value with its own colour and fill', () => {
    const values = [{ key: 'pv_estimate' }];
    const form = { ...valuesToForm(values, keys, blue), 'on:pv_estimate10': true, 'fill:pv_estimate10': 'zero', 'opacity:pv_estimate10': 35, 'line:pv_estimate10': 'none' };
    expect(valuesFromForm(form, keys, values, blue)).toEqual([
      { key: 'pv_estimate' },
      { key: 'pv_estimate10', line_style: 'none', fill: 'zero', fill_opacity: 0.35 },
    ]);
  });

  it('shows the fields of a value only once it is switched on, and its opacity only with a fill', () => {
    const names = (schema: unknown[]) => JSON.stringify(schema);
    const form = valuesToForm([{ key: 'pv_estimate' }], keys, blue);
    const schema = names(attributeValuesSchema(keys, form));
    expect(schema).toContain('color:pv_estimate"');
    expect(schema).not.toContain('color:pv_estimate10');
    expect(schema).not.toContain('opacity:pv_estimate"');
    expect(schema).toContain('Up to pv_estimate90');
  });

  it('keeps the values when the main form changes, and starts afresh with another attribute', () => {
    const original = { entity: 'sensor.p', attribute: { name: 'detailedForecast', values: [{ key: 'pv_estimate' }] } };
    expect(entityFromForm({ ...entityToForm(original, blue), name: 'PV' }, original, blue)).toEqual({ ...original, name: 'PV' });
    expect(entityFromForm({ ...entityToForm(original, blue), attribute_name: 'other' }, original, blue)).toEqual({ entity: 'sensor.p', attribute: 'other' });
    expect(entityFromForm({ ...entityToForm(original, blue), attribute_name: '' }, original, blue)).toBe('sensor.p');
  });

  it('shows the time key only when it must be picked, and no line or meter settings on the main form', () => {
    const names = (schema: unknown[]) => JSON.stringify(schema);
    const chosen = names(entitySchema('line', 'line', [], { attributes: ['detailedForecast'], keys: [], chosen: 'detailedForecast' }));
    expect(chosen).not.toContain('attribute_time');
    expect(chosen).not.toContain('"name":"line_style"');
    expect(chosen).not.toContain('"name":"statistic"');
    expect(names(entitySchema('line', 'line', [], { attributes: ['a'], keys: ['moment'], chosen: 'a', showTime: true }))).toContain('attribute_time');
  });
});
