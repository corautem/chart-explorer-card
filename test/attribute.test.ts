import { describe, expect, it } from 'vitest';
import { attributeSeries, itemKeys, listAttributes, sliceSeries, toTime } from '../src/data/attribute';
import { normalizeConfig } from '../src/config';
import { entityFromForm, entityToForm, entitySchema } from '../src/editor/schema';

const at = (time: string) => Date.parse(time);

// The shape Solcast and Predbat use for detailedForecast: half-hour slots in kW.
const forecast = [
  { period_start: '2026-10-31T10:30:00+00:00', pv_estimate: 2.1, pv_estimate10: 1.2, pv_estimate90: 2.6 },
  { period_start: '2026-10-31T10:00:00+00:00', pv_estimate: 1.8, pv_estimate10: 0.9, pv_estimate90: 2.2 },
  { period_start: '2026-10-31T11:00:00+00:00', pv_estimate: 2.4, pv_estimate10: 1.5, pv_estimate90: 2.9 },
];

describe('lists from attributes', () => {
  it('reads a forecast with a value and a shaded range, sorted by time', () => {
    const list = attributeSeries(forecast, { name: 'detailedForecast', value: 'pv_estimate', low: 'pv_estimate10', high: 'pv_estimate90' });
    expect(list.t).toEqual([at('2026-10-31T10:00:00Z'), at('2026-10-31T10:30:00Z'), at('2026-10-31T11:00:00Z')]);
    expect(list.v).toEqual([1.8, 2.1, 2.4]);
    expect(list.low).toEqual([0.9, 1.2, 1.5]);
    expect(list.high).toEqual([2.2, 2.6, 2.9]);
  });

  it('finds the time key, and the value when it is the only number', () => {
    const prices = [
      { start: '2026-10-31T10:00:00Z', end: '2026-10-31T10:30:00Z', value: 0.25 },
      { start: '2026-10-31T10:30:00Z', end: '2026-10-31T11:00:00Z', value: '0.31' },
    ];
    expect(attributeSeries(prices, { name: 'rates' }).v).toEqual([0.25, 0.31]);
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
    const list = attributeSeries(forecast, { name: 'f', value: 'pv_estimate', low: 'pv_estimate10', high: 'pv_estimate90' });
    const part = sliceSeries(list, at('2026-10-31T10:10:00Z'), at('2026-10-31T10:40:00Z'));
    expect(part.v).toEqual([1.8, 2.1, 2.4]);
    expect(part.low).toEqual([0.9, 1.2, 1.5]);
    expect(sliceSeries(list, at('2026-10-31T10:30:00Z'), at('2026-10-31T10:30:00Z')).v).toEqual([2.1]);
  });

  it('offers the attributes that hold lists, and the keys of their items', () => {
    expect(listAttributes({ friendly_name: 'PV', total: 11, detailedForecast: forecast, tags: ['a'] })).toEqual(['detailedForecast']);
    expect(itemKeys(forecast)).toEqual(['period_start', 'pv_estimate', 'pv_estimate10', 'pv_estimate90']);
  });
});

describe('attribute and fill options', () => {
  it('accepts an attribute name or the keys, line style none and a fill opacity', () => {
    const config = normalizeConfig({
      entities: [
        { entity: 'sensor.pv_forecast', attribute: 'detailedForecast' },
        { entity: 'sensor.pv_forecast', attribute: { name: 'detailedForecast', value: 'pv_estimate10' }, line_style: 'none', fill: true, fill_opacity: 0.3 },
      ],
    });
    expect(config.entities[0].attribute).toEqual({ name: 'detailedForecast' });
    expect(config.entities[1].attribute).toMatchObject({ name: 'detailedForecast', value: 'pv_estimate10' });
    expect(config.entities[1].lineStyle).toBe('none');
    expect(config.entities[1].fillOpacity).toBe(0.3);
  });

  it('explains a wrong attribute or opacity', () => {
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', attribute: { value: 'x' } as never }] })).toThrow(/attribute/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', fill_opacity: 30 }] })).toThrow(/between 0 and 1/);
  });

  it('round-trips through the editor, saving only what was set', () => {
    const blue = '#1f77b4';
    const original = {
      entity: 'sensor.pv_forecast',
      attribute: { name: 'detailedForecast', value: 'pv_estimate', low: 'pv_estimate10', high: 'pv_estimate90' },
      fill: true,
      fill_opacity: 0.3,
    };
    expect(entityFromForm(entityToForm(original, blue), original, blue)).toEqual(original);
    const named = { entity: 'sensor.pv_forecast', attribute: 'detailedForecast' };
    expect(entityFromForm(entityToForm(named, blue), named, blue)).toEqual(named);
    const back = entityFromForm({ ...entityToForm(named, blue), attribute_name: '' }, named, blue);
    expect(back).toBe('sensor.pv_forecast');
  });

  it('shows the key pickers only once an attribute is chosen, and no meter setting for it', () => {
    const names = (schema: unknown[]) => JSON.stringify(schema);
    const none = entitySchema('line', 'line', [], { attributes: ['detailedForecast'], keys: [], chosen: '' });
    expect(names(none)).toContain('attribute_name');
    expect(names(none)).not.toContain('attribute_value');
    const chosen = entitySchema('line', 'line', [], { attributes: ['detailedForecast'], keys: ['period_start', 'pv_estimate'], chosen: 'detailedForecast' });
    expect(names(chosen)).toContain('attribute_value');
    expect(names(chosen)).toContain('pv_estimate');
    expect(names(chosen)).not.toContain('"name":"statistic"');
    expect(names(chosen)).not.toContain('"name":"type"');
  });
});
