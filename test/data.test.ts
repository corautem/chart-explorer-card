import { describe, expect, it } from 'vitest';
import type { DataSettings, EntityConfig } from '../src/config';
import { normalizeConfig } from '../src/config';
import type { HomeAssistant } from '../src/ha-types';
import { parseHistory } from '../src/data/history';
import { MetaCache, canReuse, loadWindow, rawFrom, seriesFor } from '../src/data/loader';
import { chooseResolution } from '../src/data/resolution';
import { appendPoint, decimate, holdValues, trimBefore, valueAt } from '../src/data/series';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const settings: DataSettings = {
  source: 'auto',
  rawMaxHours: 24,
  fiveMinuteMaxDays: 10,
  hourlyMaxDays: 90,
};
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

describe('resolution', () => {
  const pick = (start: number, end: number, s = settings, rawSince?: number) =>
    chooseResolution({ start, end }, s, rawSince);

  it('raw history for short recent windows', () => {
    expect(pick(NOW - 6 * HOUR, NOW)).toBe('raw');
    expect(pick(NOW - 25 * HOUR, NOW)).toBe('raw'); // a 25-hour day at a clock change
  });

  it('statistics as windows get longer or older', () => {
    expect(pick(NOW - 7 * DAY, NOW)).toBe('5minute');
    expect(pick(NOW - 30 * DAY, NOW)).toBe('hour');
    expect(pick(NOW - 365 * DAY, NOW)).toBe('day');
    expect(pick(NOW - 5 * 365 * DAY, NOW)).toBe('week');
    // An old single day: raw history is tried until the card has learned where it ends.
    expect(pick(NOW - 40 * DAY, NOW - 39 * DAY)).toBe('raw');
    expect(pick(NOW - 40 * DAY, NOW - 39 * DAY, settings, NOW - 10 * DAY)).toBe('hour');
    expect(pick(NOW - 7 * DAY, NOW, settings, NOW - 10 * DAY)).toBe('5minute');
    expect(pick(NOW - 14 * DAY, NOW - 7 * DAY, settings, NOW - 10 * DAY)).toBe('hour');
  });

  it('can be forced', () => {
    expect(pick(NOW - 365 * DAY, NOW, { ...settings, source: 'history' })).toBe('raw');
    expect(pick(NOW - 6 * HOUR, NOW, { ...settings, source: 'statistics' })).toBe('5minute');
  });
});

describe('series helpers', () => {
  it('values hold until the next change', () => {
    const s = { t: [10, 20, 30], v: [1, 2, NaN] };
    expect(valueAt(s, 5)).toBeNaN();
    expect(valueAt(s, 10)).toBe(1);
    expect(valueAt(s, 25)).toBe(2);
    expect(valueAt(s, 35)).toBeNaN();
  });

  it('live points append in order and skip repeats', () => {
    const s = { t: [10], v: [1] };
    expect(appendPoint(s, 5, 2)).toBe(false);
    expect(appendPoint(s, 20, 1)).toBe(false);
    expect(appendPoint(s, 20, 3)).toBe(true);
    expect(s).toEqual({ t: [10, 20], v: [1, 3] });
  });

  it('trimming keeps the point the line enters from', () => {
    const s = { t: [10, 20, 30, 40], v: [1, 2, 3, 4] };
    trimBefore(s, 25);
    expect(s).toEqual({ t: [20, 30, 40], v: [2, 3, 4] });
  });

  it('thinning keeps peaks, dips and gaps', () => {
    const t: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < 100_000; i++) {
      t.push(i);
      v.push(i === 50_000 ? 999 : i === 70_000 ? -999 : Math.sin(i / 1000));
    }
    v[80_000] = NaN;
    const thin = decimate({ t, v }, 0, 100_000, 500);
    expect(thin.t.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...thin.v.filter((x) => !Number.isNaN(x)))).toBe(999);
    expect(Math.min(...thin.v.filter((x) => !Number.isNaN(x)))).toBe(-999);
    for (let i = 1; i < thin.t.length; i++) expect(thin.t[i]).toBeGreaterThan(thin.t[i - 1]);
  });

  it('leaves short series alone', () => {
    const s = { t: [0, 10, 20], v: [1, 2, 3] };
    expect(decimate(s, 0, 20, 500)).toEqual({ t: [0, 10, 20], v: [1, 2, 3] });
  });

  it('holds a value flat until a late change', () => {
    const held = holdValues({ t: [0, 1, 2, 100, 101], v: [5, 5.1, 5, 50, 51] }, 10);
    expect(held).toEqual({ t: [0, 1, 2, 95, 100, 101], v: [5, 5.1, 5, 5, 50, 51] });
    // Evenly spaced readings, however far apart, stay a curve.
    const even = { t: [0, 900, 1800, 2700], v: [1, 2, 3, 4] };
    expect(holdValues(even, 10)).toEqual(even);
    // Not after a gap, and not before `from` (statistics buckets).
    expect(holdValues({ t: [0, 100], v: [NaN, 50] }, 10)).toEqual({ t: [0, 100], v: [NaN, 50] });
    expect(holdValues({ t: [0, 100], v: [5, 50] }, 10, 200)).toEqual({ t: [0, 100], v: [5, 50] });
  });
});

describe('history replies', () => {
  it('clamps the first state to the window start and turns text into gaps', () => {
    const start = 1_000_000;
    const parsed = parseHistory(
      {
        'sensor.a': [
          { s: '20.5', lu: 900, lc: 800 },
          { s: 'unavailable', lu: 1100 },
          { s: '21', lu: 1200 },
          { s: '22', lu: 1200 },
        ],
      },
      ['sensor.a', 'sensor.missing'],
      start,
    );
    expect(parsed.get('sensor.a')).toEqual({ t: [start, 1_100_000, 1_200_000], v: [20.5, NaN, 22] });
    expect(parsed.get('sensor.missing')).toEqual({ t: [], v: [] });
  });
});

/** A connection that answers like Home Assistant, from fixed data. */
function fakeHass(log: Record<string, unknown>[]): HomeAssistant {
  return {
    states: {
      'sensor.temp': { entity_id: 'sensor.temp', state: '21', attributes: { unit_of_measurement: '°C' }, last_changed: '', last_updated: '' },
      'sensor.text': { entity_id: 'sensor.text', state: 'on', attributes: {}, last_changed: '', last_updated: '' },
    },
    locale: { language: 'en' },
    connection: { subscribeMessage: async () => () => undefined },
    callWS: async <T,>(msg: Record<string, unknown>) => {
      log.push(msg);
      if (msg.type === 'recorder/get_statistics_metadata') {
        return [{ statistic_id: 'sensor.temp', has_mean: true, statistics_unit_of_measurement: '°C' }] as T;
      }
      if (msg.type === 'recorder/statistics_during_period') {
        const start = Date.parse(String(msg.start_time));
        const rows = [0, 1, 2].map((i) => ({ start: start + i * HOUR, end: start + (i + 1) * HOUR, mean: 20 + i, min: 19 + i, max: 21 + i }));
        return { 'sensor.temp': rows } as T;
      }
      if (msg.type === 'history/history_during_period') {
        const start = Date.parse(String(msg.start_time)) / 1000;
        const out: Record<string, unknown[]> = {};
        for (const id of msg.entity_ids as string[]) {
          if (id === 'sensor.temp' || id === 'sensor.text') out[id] = [{ s: id === 'sensor.temp' ? '25' : 'on', lu: start }];
        }
        return out as T;
      }
      throw new Error('unexpected');
    },
  };
}

const row = (entity: string, index = 0): EntityConfig => ({
  ...normalizeConfig({ entities: [entity] }).entities[0],
  index,
  key: `${index}:${entity}`,
});

describe('loading a window', () => {
  it('raw history for a short window, in one request', async () => {
    const log: Record<string, unknown>[] = [];
    const data = await loadWindow({
      hass: fakeHass(log),
      entityIds: ['sensor.temp', 'sensor.temp'],
      window: { start: NOW - 6 * HOUR, end: NOW },
      now: NOW,
      settings,
      meta: new MetaCache(),
    });
    expect(data.resolution).toBe('raw');
    expect(log.map((m) => m.type)).toEqual(['history/history_during_period']);
    expect((log[0].entity_ids as string[]).length).toBe(1);
    expect(seriesFor(row('sensor.temp'), data).v).toEqual([25]);
  });

  it('statistics plus the recent raw tail for a long window', async () => {
    const log: Record<string, unknown>[] = [];
    const window = { start: NOW - 3 * HOUR - 5 * 60_000, end: NOW };
    const data = await loadWindow({
      hass: fakeHass(log),
      entityIds: ['sensor.temp', 'sensor.text'],
      window,
      now: NOW,
      settings: { ...settings, source: 'statistics', fiveMinuteMaxDays: 0.0001 },
      meta: new MetaCache(),
    });
    expect(data.resolution).toBe('hour');
    const temp = seriesFor(row('sensor.temp'), data);
    expect(temp.v.slice(0, 3)).toEqual([20, 21, 22]);
    expect(temp.min?.slice(0, 3)).toEqual([19, 20, 21]);
    // The raw tail starts where the last bucket ends.
    expect(temp.t[3]).toBe(window.start + 3 * HOUR);
    expect(rawFrom(row('sensor.temp'), data)).toBe(window.start + 2 * HOUR + 1);
    // An entity without statistics falls back to raw history.
    expect(seriesFor(row('sensor.text', 1), data).t.length).toBe(1);
  });

  it('the card-wide statistic applies where it fits; an entity\'s own choice wins', () => {
    const columns = { t: [0, 3_600_000], mean: [20, 21], min: [18, 19], max: [24, 25], state: [NaN, NaN] };
    const meter = { t: [0, 3_600_000], mean: [NaN, NaN], min: [NaN, NaN], max: [NaN, NaN], state: [100, 104] };
    const data = {
      window: { start: 0, end: 7_200_000 },
      resolution: 'hour' as const,
      loadedAt: 0,
      entities: new Map([
        ['sensor.temp', { entityId: 'sensor.temp', raw: { t: [], v: [] }, stats: columns, meanType: true }],
        ['sensor.meter', { entityId: 'sensor.meter', raw: { t: [], v: [] }, stats: meter, meanType: false }],
      ]),
    };
    expect(seriesFor(row('sensor.temp'), data).v).toEqual([20, 21]);
    expect(seriesFor(row('sensor.temp'), data, 'max').v).toEqual([24, 25]);
    expect(seriesFor({ ...row('sensor.temp'), statistic: 'min' }, data, 'max').v).toEqual([18, 19]);
    // Meters keep their reading whatever the card asks for.
    expect(seriesFor(row('sensor.meter', 1), data, 'max').v).toEqual([100, 104]);
  });

  it('can load a margin at the resolution of the window being looked at', async () => {
    const log: Record<string, unknown>[] = [];
    const data = await loadWindow({
      hass: fakeHass(log),
      entityIds: ['sensor.temp'],
      window: { start: NOW - 36 * HOUR, end: NOW },
      now: NOW,
      settings,
      meta: new MetaCache(),
      resolution: 'raw',
    });
    expect(data.resolution).toBe('raw');
    expect(log.map((m) => m.type)).toEqual(['history/history_during_period']);
  });

  it('asks nothing for a window entirely in the future', async () => {
    const log: Record<string, unknown>[] = [];
    const data = await loadWindow({
      hass: fakeHass(log),
      entityIds: ['sensor.temp'],
      window: { start: NOW + HOUR, end: NOW + DAY },
      now: NOW,
      settings,
      meta: new MetaCache(),
    });
    expect(log).toEqual([]);
    expect(seriesFor(row('sensor.temp'), data).t).toEqual([]);
  });

  it('fills history the recorder no longer has from hourly statistics, and learns where it ends', async () => {
    const start = NOW - 20 * HOUR;
    const purgedUntil = NOW - 12 * HOUR;
    const log: Record<string, unknown>[] = [];
    const hass = fakeHass(log);
    hass.callWS = async <T,>(msg: Record<string, unknown>) => {
      log.push(msg);
      if (msg.type === 'history/history_during_period') {
        // The recorder purged everything before `purgedUntil`.
        return { 'sensor.temp': [{ s: '25', lu: purgedUntil / 1000 }] } as T;
      }
      if (msg.type === 'recorder/get_statistics_metadata') return [{ statistic_id: 'sensor.temp', has_mean: true }] as T;
      if (msg.type === 'recorder/statistics_during_period') {
        expect(msg.period).toBe('hour');
        const rows = [];
        for (let t = start; t < Date.parse(String(msg.end_time)); t += HOUR) rows.push({ start: t, mean: 20, min: 19, max: 21 });
        return { 'sensor.temp': rows } as T;
      }
      throw new Error('unexpected');
    };
    const meta = new MetaCache();
    const data = await loadWindow({ hass, entityIds: ['sensor.temp'], window: { start, end: NOW }, now: NOW, settings, meta });
    const series = seriesFor(row('sensor.temp'), data);
    expect(series.t[0]).toBe(start);
    expect(series.v[0]).toBe(20);
    expect(series.t[series.t.length - 1]).toBe(purgedUntil);
    expect(series.v[series.v.length - 1]).toBe(25);
    expect(series.t.every((t, i) => i === 0 || t > series.t[i - 1])).toBe(true);
    expect(meta.rawSince(NOW)).toBe(purgedUntil);
    expect(log.map((m) => m.type)).toEqual([
      'history/history_during_period',
      'recorder/get_statistics_metadata',
      'recorder/statistics_during_period',
    ]);
  });

  it('flags entities that do not exist', async () => {
    const data = await loadWindow({
      hass: fakeHass([]),
      entityIds: ['sensor.gone'],
      window: { start: NOW - HOUR, end: NOW },
      now: NOW,
      settings,
      meta: new MetaCache(),
    });
    expect(data.entities.get('sensor.gone')?.error).toBe('not_found');
  });

  it('zooming inside loaded data needs no request', () => {
    const data = { window: { start: NOW - DAY, end: NOW }, resolution: 'raw' as const, loadedAt: NOW, entities: new Map() };
    expect(canReuse(data, { start: NOW - 6 * HOUR, end: NOW - 2 * HOUR }, NOW, settings)).toBe(true);
    expect(canReuse(data, { start: NOW - 2 * DAY, end: NOW }, NOW, settings)).toBe(false);
  });
});
