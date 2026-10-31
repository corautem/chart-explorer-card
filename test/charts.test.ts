import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config';
import type { HassEntity, HomeAssistant } from '../src/ha-types';
import { hasTextStates, kindSettled, rowKind, textStatesInHistory } from '../src/rows';
import { isOnState, stateColor } from '../src/chart/states';
import { mainState, periodStates, stateDurations, timelineSegments } from '../src/chart/timeline';
import { placeBars, timelineHeight } from '../src/chart/timeseries';
import { heatColor } from '../src/chart/heatmap';
import { seriesColor } from '../src/chart/theme';
import {
  accumulators,
  addRaw,
  addRow,
  bucketAt,
  bucketPeriodFor,
  finish,
  loadBuckets,
  periodEdges,
  windowValue,
} from '../src/data/buckets';
import { MetaCache } from '../src/data/loader';
import { appendPoint, stateAt, trimBefore } from '../src/data/series';
import { parseHistory } from '../src/data/history';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '',
  last_updated: '',
});

describe('row kinds', () => {
  it('finds entities whose states are words', () => {
    expect(hasTextStates(entity('binary_sensor.demo_door', 'off'))).toBe(true);
    expect(hasTextStates(entity('climate.demo_room', 'heat'))).toBe(true);
    expect(hasTextStates(entity('sensor.demo_status', 'standby'))).toBe(true);
    expect(hasTextStates(entity('sensor.demo_mode', '3', { device_class: 'enum', options: ['1', '3'] }))).toBe(true);
    expect(hasTextStates(entity('sensor.demo_temperature', '21.5', { unit_of_measurement: '°C' }))).toBe(false);
    expect(hasTextStates(entity('sensor.demo_count', '7'))).toBe(false);
    // An unavailable number stays a line; without a unit the state alone cannot tell, so the history decides.
    expect(hasTextStates(entity('sensor.demo_power', 'unavailable', { unit_of_measurement: 'W' }))).toBe(false);
    expect(hasTextStates(entity('sensor.demo_unknown', 'unknown'))).toBe(false);
    expect(hasTextStates(undefined)).toBe(false);
  });

  it('judges a sensor that is unknown right now by its recorded states', () => {
    const unknown = entity('sensor.demo_status', 'unknown');
    expect(textStatesInHistory(['unknown', 'standby', 'heating'])).toBe(true);
    expect(textStatesInHistory(['unavailable', '12', '13.5'])).toBe(false);
    expect(textStatesInHistory(['unknown', ''])).toBeUndefined();
    // Before the history has loaded: a strip, so the words load, and not settled yet.
    expect(rowKind('auto', 'line', unknown)).toBe('timeline');
    expect(kindSettled('auto', unknown)).toBe(false);
    expect(rowKind('auto', 'line', unknown, ['standby', 'unknown'])).toBe('timeline');
    expect(rowKind('auto', 'bar', unknown, ['3', 'unknown'])).toBe('bar');
    expect(kindSettled('auto', unknown, ['3'])).toBe(true);
    expect(kindSettled('line', unknown)).toBe(true);
    // A unit settles it at once, unavailable or not.
    expect(kindSettled('auto', entity('sensor.demo_power', 'unavailable', { unit_of_measurement: 'W' }))).toBe(true);
  });

  it('lets the row choose, and draws numbers as bars in a bar chart', () => {
    const status = entity('sensor.demo_status', 'standby');
    const power = entity('sensor.demo_power', '120', { unit_of_measurement: 'W' });
    expect(rowKind('auto', 'line', status)).toBe('timeline');
    expect(rowKind('auto', 'bar', power)).toBe('bar');
    expect(rowKind('auto', 'line', power)).toBe('line');
    expect(rowKind('band', 'line', status)).toBe('band');
    expect(rowKind('line', 'bar', power)).toBe('line');
  });
});

describe('state colours', () => {
  const context = { overrides: {}, entityColor: '#123456', neutral: 'grey', dark: false };

  it('keeps one colour per state wherever it is drawn', () => {
    expect(stateColor('heating', context)).toBe(stateColor('heating', { ...context, overrides: { standby: '#000000' } }));
    expect(stateColor('on', context)).toBe('#123456');
    expect(stateColor('standby', context)).toBe('grey');
    expect(stateColor('Off', context)).toBe('grey');
    expect(stateColor('unavailable', context)).toBeUndefined();
    expect(stateColor('unknown', context)).toBeUndefined();
    expect(stateColor('heating', { ...context, overrides: { heating: '#ff0000' } })).toBe('#ff0000');
    // Unavailable is striped unless it gets a colour; standby can leave the grey.
    expect(stateColor('unavailable', { ...context, overrides: { unavailable: '#000000' } })).toBe('#000000');
    expect(stateColor('standby', { ...context, overrides: { standby: '#3987e5' } })).toBe('#3987e5');
  });

  it('gives listed options the palette in order, skipping quiet ones', () => {
    const options = ['off', 'low', 'high'];
    expect(stateColor('low', { ...context, options })).toBe(seriesColor(0, false).color);
    expect(stateColor('high', { ...context, options })).toBe(seriesColor(1, false).color);
  });

  it('shades bands for on states, or for the states listed', () => {
    const row = normalizeConfig({ entities: ['binary_sensor.a'] }).entities[0];
    expect(isOnState(row, 'on')).toBe(true);
    expect(isOnState(row, 'idle')).toBe(false);
    expect(isOnState(row, 'unavailable')).toBe(false);
    const listed = normalizeConfig({ entities: [{ entity: 'sensor.a', on_states: ['defrost'] }] }).entities[0];
    expect(isOnState(listed, 'defrost')).toBe(true);
    expect(isOnState(listed, 'heating')).toBe(false);
  });
});

describe('state series', () => {
  it('keeps the state text from history and live states', () => {
    const parsed = parseHistory(
      { 'sensor.a': [{ s: 'standby', lu: 100 }, { s: 'heating', lu: 200 }] },
      ['sensor.a', 'sensor.b'],
      0,
      new Set(['sensor.a']),
    );
    const series = parsed.get('sensor.a')!;
    expect(series.s).toEqual(['standby', 'heating']);
    expect(parsed.get('sensor.b')!.s).toBeUndefined();
    expect(appendPoint(series, 300_000, NaN, 'heating')).toBe(false);
    expect(appendPoint(series, 300_000, NaN, 'defrost')).toBe(true);
    expect(stateAt(series, 250_000)).toBe('heating');
    trimBefore(series, 250_000);
    expect(series.s).toEqual(['heating', 'defrost']);
  });
});

describe('timeline', () => {
  const series = { t: [0, 10, 20, 30, 31, 32, 60], v: [], s: ['a', 'a', 'b', 'c', 'b', 'c', 'a'] };

  it('merges repeats and clips to the window', () => {
    expect(timelineSegments(series, 5, 25, 0)).toEqual([
      { start: 5, end: 20, state: 'a' },
      { start: 20, end: 25, state: 'b' },
    ]);
  });

  it('pools stretches shorter than a pixel into the state that held longest', () => {
    const segments = timelineSegments(series, 0, 70, 5);
    expect(segments).toEqual([
      { start: 0, end: 20, state: 'a' },
      { start: 20, end: 30, state: 'b' },
      { start: 30, end: 60, state: 'c' },
      { start: 60, end: 70, state: 'a' },
    ]);
  });

  it('adds up the time in each state', () => {
    const totals = stateDurations(series, 0, 70);
    expect(totals.get('a')).toBe(30);
    expect(totals.get('b')).toBe(11);
    expect(totals.get('c')).toBe(29);
  });

  it('sizes the strips', () => {
    expect(timelineHeight(0, 22, true)).toBe(0);
    expect(timelineHeight(2, 22, true)).toBe(2 * (22 + 4 + 15));
    expect(timelineHeight(2, 22, false)).toBe(2 * (22 + 4));
  });
});

describe('bars', () => {
  const day = (n: number) => n * DAY;
  const a = { t: [day(0), day(1)], end: [day(1), day(2)], v: [4, -2] };
  const b = { t: [day(0), day(1)], end: [day(1), day(2)], v: [1, NaN] };

  it('stand side by side within their period', () => {
    const [first, second] = placeBars([a, b], false);
    expect(first[0]).toEqual({ start: day(0) + 0.1 * DAY, end: day(0) + 0.5 * DAY, low: 0, high: 4 });
    expect(second[0]).toEqual({ start: day(0) + 0.5 * DAY, end: day(0) + 0.9 * DAY, low: 0, high: 1 });
    expect(first[1]).toMatchObject({ low: -2, high: 0 });
    expect(second).toHaveLength(1);
  });

  it('stack, rises upwards and drops downwards', () => {
    const [first, second] = placeBars([a, { ...a, v: [1, -3] }], true);
    expect(first[0]).toMatchObject({ low: 0, high: 4 });
    expect(second[0]).toMatchObject({ low: 4, high: 5 });
    expect(first[1]).toMatchObject({ low: 0, high: -2 });
    expect(second[1]).toMatchObject({ low: -2, high: -5 });
  });
});

describe('periods', () => {
  it('picks the bar length from the window', () => {
    const w = (days: number) => ({ start: 0, end: days * DAY });
    expect(bucketPeriodFor(w(1), 'auto')).toBe('hour');
    expect(bucketPeriodFor(w(7), 'auto')).toBe('day');
    expect(bucketPeriodFor(w(90), 'auto')).toBe('week');
    expect(bucketPeriodFor(w(365), 'auto')).toBe('month');
    expect(bucketPeriodFor(w(365), 'day')).toBe('day');
  });

  it('steps through local hours across both clock changes', () => {
    // Clock changes in 2026: Europe 29 Mar and 25 Oct, United States 8 Mar and 1 Nov, Sydney 5 Apr and 4 Oct.
    const days = [[2, 29], [9, 25], [2, 8], [10, 1], [3, 5], [9, 4]].map(([month, date]) => new Date(2026, month, date));
    for (const day of days) {
      const start = day.getTime();
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      const edges = periodEdges(start, end, 'hour', 1);
      for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
      for (const edge of edges) expect(new Date(edge).getMinutes()).toBe(0);
      expect(edges[edges.length - 1]).toBe(end);
      expect(edges.length - 1).toBe(Math.round((end - start) / HOUR));
    }
  });

  it('follows the week start and calendar months', () => {
    const wednesday = new Date(2026, 9, 28, 15).getTime();
    expect(new Date(periodEdges(wednesday, wednesday + 1, 'week', 1)[0]).getDay()).toBe(1);
    expect(new Date(periodEdges(wednesday, wednesday + 1, 'week', 0)[0]).getDay()).toBe(0);
    const months = periodEdges(new Date(2026, 0, 15).getTime(), new Date(2026, 3, 2).getTime(), 'month', 1);
    expect(months.map((ms) => new Date(ms).getMonth())).toEqual([0, 1, 2, 3, 4]);
    expect(months.every((ms) => new Date(ms).getDate() === 1)).toBe(true);
  });

  it('weighs held values by time and counts meter rises, resets included', () => {
    const edges = [0, HOUR, 2 * HOUR];
    const accs = accumulators(2);
    // 10 for 30 minutes, 20 for 60 minutes (half in each hour), then a reset to 2.
    addRaw(accs, edges, { t: [0, 30 * MINUTE, 90 * MINUTE], v: [10, 20, 2] }, 0, 2 * HOUR);
    const buckets = finish(accs, edges);
    expect(buckets.mean[0]).toBeCloseTo(15);
    expect(buckets.mean[1]).toBeCloseTo(11);
    expect(buckets.change).toEqual([10, 2]);
    expect([buckets.min[0], buckets.max[0]]).toEqual([10, 20]);
    // A meter that may go down counts the drop.
    const both = accumulators(2);
    addRaw(both, edges, { t: [0, 30 * MINUTE, 90 * MINUTE], v: [10, 20, 2] }, 0, 2 * HOUR, false);
    expect(finish(both, edges).change).toEqual([10, -18]);
  });

  it('places statistics rows by their start and leaves empty periods empty', () => {
    const edges = [0, DAY, 2 * DAY];
    const accs = accumulators(2);
    addRow(accs, edges, { start: 0, end: DAY, mean: 4, min: 1, max: 9, change: 3 }, DAY);
    const buckets = finish(accs, edges);
    expect([buckets.mean[0], buckets.change[0]]).toEqual([4, 3]);
    expect(Number.isNaN(buckets.mean[1]) && Number.isNaN(buckets.change[1])).toBe(true);
  });

  it('reads one period and a whole window', () => {
    const meter = { t: [0, HOUR, 2 * HOUR], end: [HOUR, 2 * HOUR, 3 * HOUR], v: [1, 2, NaN], meanType: false };
    expect(bucketAt(meter, HOUR + 5)).toBe(2);
    expect(Number.isNaN(bucketAt(meter, 5 * HOUR))).toBe(true);
    expect(windowValue(meter, 0, 3 * HOUR)).toBe(3);
    const average = { ...meter, v: [10, 20, NaN], meanType: true };
    // The second hour counts for half of its length: the window ends half way.
    expect(windowValue(average, 0, 1.5 * HOUR)).toBeCloseTo(13.333, 2);
    expect(windowValue(average, 0, 3 * HOUR, 'max')).toBe(20);
  });
});

describe('loading periods', () => {
  const now = new Date(2026, 9, 31, 10, 20).getTime();
  const at = (h: number, m = 0) => new Date(2026, 9, 31, h, m).getTime();

  function fakeHass(log: Record<string, unknown>[]): HomeAssistant {
    return {
      states: { 'sensor.demo_energy': entity('sensor.demo_energy', '5', { state_class: 'total_increasing' }) },
      locale: { language: 'en' },
      connection: { subscribeMessage: async () => () => undefined },
      callWS: async <T,>(msg: Record<string, unknown>) => {
        log.push(msg);
        if (msg.type === 'recorder/get_statistics_metadata') {
          return [{ statistic_id: 'sensor.demo_energy', has_sum: true, statistics_unit_of_measurement: 'kWh' }] as T;
        }
        if (msg.type === 'recorder/statistics_during_period') {
          // Hours up to 09:00 compiled: 1 kWh each.
          const rows = [];
          for (let h = 0; h < 9; h++) rows.push({ start: at(h), end: at(h + 1), change: 1 });
          return { 'sensor.demo_energy': rows } as T;
        }
        // Raw history: 9.0 at 09:00, 9.4 at 09:30 and 9.7 at 10:10.
        return { 'sensor.demo_energy': [{ s: '9.0', lu: at(9) / 1000 }, { s: '9.4', lu: at(9, 30) / 1000 }, { s: '9.7', lu: at(10, 10) / 1000 }] } as T;
      },
    };
  }

  it('adds the hours not yet compiled from raw history', async () => {
    const log: Record<string, unknown>[] = [];
    const data = await loadBuckets(fakeHass(log), ['sensor.demo_energy'], { start: at(0), end: at(24) }, now, 'hour', new MetaCache());
    const { buckets, meanType, unit } = data.entities.get('sensor.demo_energy')!;
    expect(meanType).toBe(false);
    expect(unit).toBe('kWh');
    expect(buckets.change.slice(0, 9)).toEqual(Array(9).fill(1));
    expect(buckets.change[9]).toBeCloseTo(0.4);
    expect(buckets.change[10]).toBeCloseTo(0.3);
    // Periods stop at the one in progress.
    expect(buckets.t).toHaveLength(11);
    expect(log.some((msg) => (msg.types as string[] | undefined)?.includes('change'))).toBe(true);
  });
});

describe('heatmap colours', () => {
  it('runs from near the background to the entity colour', () => {
    expect(heatColor(1, '#2a78d6', '#ffffff')).toBe('#2a78d6');
    expect(heatColor(0, '#2a78d6', '#ffffff')).toBe('#eaf2fb');
  });
});

describe('heatmap of states', () => {
  const series = { t: [10, 50, 100], v: [NaN, NaN, NaN], s: ['standby', 'heating', 'standby'] };
  const edges = [0, 60, 120, 180];

  it('adds up the time in each state hour by hour, up to now', () => {
    const periods = periodStates(series, edges, 150);
    expect(periods.map((p) => [p.start, p.end])).toEqual([[0, 60], [60, 120], [120, 180]]);
    expect([...periods[0].durations]).toEqual([['standby', 40], ['heating', 10]]);
    expect([...periods[1].durations]).toEqual([['heating', 40], ['standby', 20]]);
    expect([...periods[2].durations]).toEqual([['standby', 30]]);
    expect(periods.map((p) => mainState(p.durations))).toEqual(['standby', 'heating', 'standby']);
  });

  it('leaves out hours before the history starts and splits a long state across hours', () => {
    expect(periodStates({ t: [70], v: [NaN], s: ['on'] }, edges, 180).map((p) => p.start)).toEqual([60, 120]);
    const long = periodStates({ t: [0], v: [NaN], s: ['on'] }, edges, 180);
    expect(long.map((p) => p.durations.get('on'))).toEqual([60, 60, 60]);
  });

  it('takes the first of states that held equally long', () => {
    expect(mainState(new Map([['heating', 30], ['standby', 30]]))).toBe('heating');
    expect(mainState(new Map())).toBeUndefined();
  });
});

describe('chart settings', () => {
  it('reads chart types, bar periods, timelines and entity kinds', () => {
    const c = normalizeConfig({
      entities: [{ entity: 'sensor.a', type: 'band', state_colors: { standby: '#888888' }, on_states: ['on'] }],
      chart_type: 'bar',
      stacked: true,
      period: 'week',
      timeline_row_height: 30,
    });
    expect([c.chartType, c.stacked, c.period]).toEqual(['bar', true, 'week']);
    expect(c.timeline).toEqual({ rowHeight: 30, names: true, labels: true });
    expect(c.entities[0]).toMatchObject({ type: 'band', stateColors: { standby: '#888888' }, onStates: ['on'] });
    const plain = normalizeConfig({ entities: ['sensor.a'] });
    expect([plain.chartType, plain.period, plain.entities[0].type]).toEqual(['line', 'auto', 'auto']);
    expect(() => normalizeConfig({ entities: ['sensor.a'], chart_type: 'radar' as never })).toThrow(/chart_type/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', type: 'dots' as never }] })).toThrow(/type/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', state_colors: ['red'] as never }] })).toThrow(/state_colors/);
  });
});
