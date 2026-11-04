// A stand-in for Home Assistant on the test page: made-up entities, generated
// history and statistics, and live state changes. No real installation involved.

import type { HassEntity, HomeAssistant } from '../src/ha-types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RETENTION_DAYS = 10;
const LONG_TERM_DAYS = 800;

interface FakeEntity {
  id: string;
  name: string;
  unit?: string;
  stateClass?: 'measurement' | 'total_increasing' | 'total';
  deviceClass?: string;
  options?: string[];
  interval: number;
  value(t: number): number | string;
  precision?: number;
  /** Further attributes, such as a forecast list. */
  extra?(now: number): Record<string, unknown>;
}

/** Deterministic noise in [-1, 1] for a time step and seed. */
function noise(step: number, seed: number): number {
  let x = Math.imul(step ^ (seed * 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return ((x >>> 0) / 0xffffffff) * 2 - 1;
}

const yearly = (t: number) => Math.cos((2 * Math.PI * (t / DAY - 15)) / 365.25);
const daily = (t: number) => {
  const d = new Date(t);
  const hours = d.getHours() + d.getMinutes() / 60;
  return Math.sin((2 * Math.PI * (hours - 9)) / 24);
};

const outdoor = (t: number) => 9 - 6 * yearly(t) + 4 * daily(t) + 0.6 * noise(Math.floor(t / (10 * MINUTE)), 3);
const heatingOn = (t: number) => {
  const cycle = Math.floor(t / (40 * MINUTE));
  return outdoor(t) < 14 && noise(cycle, 7) > -0.2;
};

/** A meter that only rises: kWh used since a made-up start, about 0.6 kWh an hour with a daily swing. */
const meter = (rate: number, seed: number) => (t: number) => {
  const h = t / HOUR;
  const swing = 0.4 * rate * (24 / (2 * Math.PI)) * Math.cos((2 * Math.PI * (h - 9 - seed)) / 24);
  return Math.floor((rate * h - swing - 490_000 * rate) * 100) / 100;
};

/**
 * A running total that never resets (state class total): `rate` an hour on
 * average with a daily swing, counted from a made-up start.
 */
const runningTotal = (rate: number, seed: number) => (t: number) => {
  const h = t / HOUR;
  return rate * (h - 490_000) - 0.4 * rate * (24 / (2 * Math.PI)) * Math.cos((2 * Math.PI * (h - 9 - seed)) / 24);
};
/**
 * Heat delivered for a heat pump's electricity meter in Wh: about `cop` times
 * its energy, drifting over a few days, with small dips during a defrost.
 */
const heatDelivered = (electricityWh: (t: number) => number, cop: number, drift: number, dips: number) => (t: number) => {
  const h = t / HOUR;
  const heat = (cop * electricityWh(t)) / 1000 + drift * Math.sin((2 * Math.PI * h) / (24 * 5.3));
  return Math.round((heat - dips * Math.max(0, Math.sin(2 * Math.PI * h * 1.3))) * 1000) / 1000;
};
const spaceHeatingWh = runningTotal(600, 2);
const hotWaterWh = runningTotal(150, 7);

/** A heat pump's status: standby, heating, hot water and a short defrost now and then. */
const status = (t: number): string => {
  const slot = Math.floor(t / (20 * MINUTE));
  if (noise(slot, 11) > 0.93) return 'unknown';
  if (!heatingOn(t)) return noise(slot, 12) > 0.75 ? 'hot_water' : 'standby';
  return noise(slot, 13) > 0.85 ? 'defrost' : 'heating';
};

/** Clear-sky solar power in kW for a local time: a curve from 07:30 to 17:00, highest at noon. */
const clearSky = (t: number) => {
  const d = new Date(t);
  const hours = d.getHours() + d.getMinutes() / 60;
  return hours < 7.5 || hours > 17 ? 0 : 3 * Math.sin((Math.PI * (hours - 7.5)) / 9.5) ** 1.5;
};
/** Measured solar power: the clear-sky curve with passing clouds. */
const solar = (t: number) => {
  const clouds = 0.75 + 0.25 * noise(Math.floor(t / (40 * MINUTE)), 21) + 0.08 * noise(Math.floor(t / MINUTE), 22);
  return Math.max(0, clearSky(t) * clouds);
};
/** A Solcast-style forecast: half-hour slots from yesterday to tomorrow, with low and high estimates. */
const forecastSlots = (now: number) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const slots: Record<string, unknown>[] = [];
  for (let k = 0; k < 144; k++) {
    const at = start.getTime() + k * 30 * MINUTE;
    const estimate = clearSky(at + 15 * MINUTE) * (0.72 + 0.1 * noise(Math.floor(at / DAY), 23));
    const round = (value: number) => Math.round(value * 100) / 100;
    slots.push({
      period_start: new Date(at).toISOString(),
      pv_estimate: round(estimate),
      pv_estimate10: round(estimate * 0.55),
      pv_estimate90: round(estimate * 1.2),
    });
  }
  return slots;
};

export const ENTITIES: FakeEntity[] = [
  {
    id: 'sensor.demo_flow_temperature',
    name: 'Demo flow temperature',
    unit: '°C',
    stateClass: 'measurement',
    deviceClass: 'temperature',
    interval: MINUTE,
    precision: 1,
    value: (t) => (heatingOn(t) ? 38 - outdoor(t) * 0.6 : 24) + 0.4 * noise(Math.floor(t / MINUTE), 1),
  },
  {
    id: 'sensor.demo_return_temperature',
    name: 'Demo return temperature',
    unit: '°C',
    stateClass: 'measurement',
    deviceClass: 'temperature',
    interval: MINUTE,
    precision: 1,
    value: (t) => (heatingOn(t) ? 32 - outdoor(t) * 0.5 : 23) + 0.3 * noise(Math.floor(t / MINUTE), 2),
  },
  {
    id: 'sensor.demo_outdoor_temperature',
    name: 'Demo outdoor temperature',
    unit: '°C',
    stateClass: 'measurement',
    deviceClass: 'temperature',
    interval: 5 * MINUTE,
    precision: 1,
    // Unavailable for twenty minutes every night at 03:00.
    value: (t) => {
      const d = new Date(t);
      return d.getHours() === 3 && d.getMinutes() < 20 ? 'unavailable' : outdoor(t);
    },
  },
  {
    id: 'sensor.demo_heat_pump_power',
    name: 'Demo heat pump power',
    unit: 'W',
    stateClass: 'measurement',
    deviceClass: 'power',
    interval: 30_000,
    precision: 0,
    value: (t) => (heatingOn(t) ? 1400 + 500 * noise(Math.floor(t / 30_000), 4) - outdoor(t) * 40 : 6),
  },
  {
    id: 'sensor.demo_heat_pump_status',
    name: 'Demo heat pump status',
    interval: 5 * MINUTE,
    value: status,
  },
  {
    id: 'binary_sensor.demo_heating',
    name: 'Demo heating',
    interval: 5 * MINUTE,
    value: (t) => (heatingOn(t) ? 'on' : 'off'),
  },
  {
    id: 'sensor.demo_energy',
    name: 'Demo heat pump energy',
    unit: 'kWh',
    stateClass: 'total_increasing',
    deviceClass: 'energy',
    interval: MINUTE,
    precision: 2,
    value: meter(0.6, 0),
  },
  {
    id: 'sensor.demo_hot_water_energy',
    name: 'Demo hot water energy',
    unit: 'kWh',
    stateClass: 'total_increasing',
    deviceClass: 'energy',
    interval: MINUTE,
    precision: 2,
    value: meter(0.25, 6),
  },
  {
    id: 'sensor.demo_house_power',
    name: 'Demo house power',
    unit: 'W',
    stateClass: 'measurement',
    deviceClass: 'power',
    interval: MINUTE,
    precision: 0,
    value: (t) => 300 + 200 * Math.max(0, daily(t)) + 80 * noise(Math.floor(t / MINUTE), 9),
  },
  {
    id: 'sensor.demo_heat_pump_heat_space_heating',
    name: 'Demo heat delivered, space heating',
    unit: 'kWh',
    stateClass: 'total',
    deviceClass: 'energy',
    interval: 5 * MINUTE,
    precision: 3,
    value: heatDelivered(spaceHeatingWh, 3.4, 8, 0.04),
  },
  {
    id: 'sensor.demo_heat_pump_heat_hot_water',
    name: 'Demo heat delivered, hot water',
    unit: 'kWh',
    stateClass: 'total',
    deviceClass: 'energy',
    interval: 5 * MINUTE,
    precision: 3,
    value: heatDelivered(hotWaterWh, 2.6, 2, 0),
  },
  {
    id: 'sensor.demo_heat_pump_electricity_space_heating',
    name: 'Demo electricity used, space heating',
    unit: 'Wh',
    stateClass: 'total',
    deviceClass: 'energy',
    interval: 5 * MINUTE,
    precision: 0,
    value: (t) => Math.round(spaceHeatingWh(t)),
  },
  {
    id: 'sensor.demo_heat_pump_electricity_hot_water',
    name: 'Demo electricity used, hot water',
    unit: 'Wh',
    stateClass: 'total',
    deviceClass: 'energy',
    interval: 5 * MINUTE,
    precision: 0,
    value: (t) => Math.round(hotWaterWh(t)),
  },
  {
    id: 'sensor.demo_solar_power',
    name: 'Demo solar power',
    unit: 'kW',
    stateClass: 'measurement',
    deviceClass: 'power',
    interval: MINUTE,
    precision: 2,
    value: solar,
  },
  {
    id: 'sensor.demo_pv_forecast',
    name: 'Demo PV forecast today',
    unit: 'kWh',
    interval: 30 * MINUTE,
    precision: 2,
    value: (t) => {
      const slots = forecastSlots(t).slice(48, 96);
      return slots.reduce((sum, slot) => sum + (slot.pv_estimate as number) / 2, 0);
    },
    // Also a map of times to numbers, the shape of Predbat's results attribute.
    extra: (now) => ({
      detailedForecast: forecastSlots(now),
      results: Object.fromEntries(forecastSlots(now).map((slot) => [slot.period_start, slot.pv_estimate])),
    }),
  },
  {
    id: 'sensor.demo_no_statistics',
    name: 'Demo value without statistics',
    unit: '%',
    interval: 15 * MINUTE,
    precision: 0,
    value: (t) => 50 + 30 * daily(t),
  },
];

/** Eight noisy sensors reporting every 30 seconds, for the load check. */
export function addLoadEntities(): string[] {
  const ids: string[] = [];
  for (let n = 1; n <= 8; n++) {
    const id = `sensor.demo_load_${n}`;
    ids.push(id);
    if (!ENTITIES.some((e) => e.id === id)) {
      ENTITIES.push({
        id,
        name: `Demo load ${n}`,
        unit: n <= 4 ? '°C' : 'W',
        stateClass: 'measurement',
        interval: 30_000,
        precision: 2,
        value: (t) => (n <= 4 ? 20 + n : 500 * n) + 5 * daily(t) + noise(Math.floor(t / 30_000), 20 + n),
      });
    }
  }
  return ids;
}

function stateText(entity: FakeEntity, t: number): string {
  const value = entity.value(t);
  return typeof value === 'number' ? value.toFixed(entity.precision ?? 1) : value;
}

function aligned(t: number, interval: number): number {
  return Math.floor(t / interval) * interval;
}

function stateObject(entity: FakeEntity, now: number): HassEntity {
  const changed = new Date(aligned(now, entity.interval)).toISOString();
  return {
    entity_id: entity.id,
    state: stateText(entity, now),
    attributes: {
      friendly_name: entity.name,
      ...(entity.unit ? { unit_of_measurement: entity.unit } : {}),
      ...(entity.stateClass ? { state_class: entity.stateClass } : {}),
      ...(entity.deviceClass ? { device_class: entity.deviceClass } : {}),
      ...(entity.options ? { options: entity.options } : {}),
      ...(entity.extra ? entity.extra(now) : {}),
    },
    last_changed: changed,
    last_updated: changed,
  };
}

function history(msg: Record<string, unknown>) {
  const start = Date.parse(String(msg.start_time));
  const end = Date.parse(String(msg.end_time));
  const retention = Date.now() - RETENTION_DAYS * DAY;
  const out: Record<string, { s: string; lu: number }[]> = {};
  for (const id of msg.entity_ids as string[]) {
    const entity = ENTITIES.find((e) => e.id === id);
    if (!entity) continue;
    const rows: { s: string; lu: number }[] = [];
    const from = Math.max(start, retention);
    if (from < end) {
      rows.push({ s: stateText(entity, from), lu: aligned(from, entity.interval) / 1000 });
      for (let t = aligned(from, entity.interval) + entity.interval; t < end; t += entity.interval) {
        const s = stateText(entity, t);
        if (s !== rows[rows.length - 1].s) rows.push({ s, lu: t / 1000 });
      }
    }
    out[id] = rows;
  }
  return out;
}

const PERIODS: Record<string, number> = { '5minute': 5 * MINUTE, hour: HOUR, day: DAY, week: 7 * DAY };

function statistics(msg: Record<string, unknown>) {
  const start = Date.parse(String(msg.start_time));
  const end = Date.parse(String(msg.end_time));
  const period = String(msg.period);
  const size = PERIODS[period] ?? HOUR;
  const now = Date.now();
  const earliest = period === '5minute' ? now - RETENTION_DAYS * DAY : now - LONG_TERM_DAYS * DAY;
  const out: Record<string, unknown[]> = {};
  const next = (bucket: number) => {
    if (period !== 'month') return bucket + size;
    const d = new Date(bucket);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  };
  const first = () => {
    if (period === 'month') {
      const d = new Date(localStartOfDay(start));
      d.setDate(1);
      return d.getTime();
    }
    return period === 'day' || period === 'week' ? localStartOfDay(start) : aligned(start, size);
  };
  for (const id of msg.statistic_ids as string[]) {
    const entity = ENTITIES.find((e) => e.id === id);
    if (!entity?.stateClass) continue;
    const rows: unknown[] = [];
    // Hourly statistics are compiled about 10 minutes after each hour; days and
    // months include the hours compiled so far.
    const compiled = aligned(now - 10 * MINUTE, HOUR);
    for (let bucket = first(); bucket < end && bucket < compiled; bucket = next(bucket)) {
      const bucketEnd = next(bucket);
      if (bucket < earliest) continue;
      const stop = Math.min(bucketEnd, compiled);
      if (entity.stateClass === 'total_increasing' || entity.stateClass === 'total') {
        const reading = entity.value as (t: number) => number;
        rows.push({ start: bucket, end: bucketEnd, state: reading(stop), sum: reading(stop), change: reading(stop) - reading(bucket) });
        continue;
      }
      const samples: number[] = [];
      for (let k = 0; k < 12; k++) {
        const v = entity.value(bucket + (k + 0.5) * ((stop - bucket) / 12));
        if (typeof v === 'number') samples.push(v);
      }
      if (!samples.length) continue;
      rows.push({
        start: bucket,
        end: bucketEnd,
        mean: samples.reduce((a, b) => a + b, 0) / samples.length,
        min: Math.min(...samples),
        max: Math.max(...samples),
      });
    }
    out[id] = rows;
  }
  return out;
}

function localStartOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function metadata(msg: Record<string, unknown>) {
  return (msg.statistic_ids as string[])
    .map((id) => ENTITIES.find((e) => e.id === id))
    .filter((e): e is FakeEntity => Boolean(e?.stateClass))
    .map((e) => ({
      statistic_id: e.id,
      has_mean: e.stateClass === 'measurement',
      has_sum: e.stateClass === 'total_increasing' || e.stateClass === 'total',
      mean_type: e.stateClass === 'measurement' ? 1 : 0,
      statistics_unit_of_measurement: e.unit ?? null,
    }));
}

export interface FakeOptions {
  delay: number;
  fail: boolean;
  dark: boolean;
  language: string;
}

export function createHass(options: FakeOptions): HomeAssistant {
  const now = Date.now();
  const states: Record<string, HassEntity> = {};
  for (const entity of ENTITIES) states[entity.id] = stateObject(entity, now);
  const entities: Record<string, { display_precision?: number }> = {};
  for (const entity of ENTITIES) entities[entity.id] = { display_precision: entity.precision };

  const respond = (msg: Record<string, unknown>): unknown => {
    switch (msg.type) {
      case 'history/history_during_period':
        return history(msg);
      case 'recorder/statistics_during_period':
        return statistics(msg);
      case 'recorder/get_statistics_metadata':
        return metadata(msg);
      default:
        throw { code: 'unknown_command', message: `Unknown command ${String(msg.type)}` };
    }
  };

  const hass: HomeAssistant = {
    states,
    entities,
    language: options.language,
    locale: { language: options.language, number_format: 'language', time_format: 'language', first_weekday: 'language' },
    themes: { darkMode: options.dark },
    callWS: <T,>(msg: Record<string, unknown>) =>
      new Promise<T>((resolve, reject) => {
        (window as unknown as { __wsLog?: unknown[] }).__wsLog?.push(msg);
        setTimeout(() => {
          if (options.fail) {
            reject({ code: 'unknown_error', message: 'Simulated failure' });
            return;
          }
          try {
            resolve(respond(msg) as T);
          } catch (err) {
            reject(err);
          }
        }, options.delay);
      }),
    connection: { subscribeMessage: async () => () => undefined },
    // Like Home Assistant's translations: "hot_water" shows as "Hot water".
    formatEntityState: (stateObj, state = stateObj.state) => {
      if (Number.isFinite(Number(state)) && state !== '') return state;
      const words = state.replace(/_/g, ' ');
      return words.charAt(0).toUpperCase() + words.slice(1);
    },
  };
  return hass;
}

/** A new hass object with fresh states, as Home Assistant hands cards on every change. */
export function tickHass(hass: HomeAssistant): HomeAssistant {
  const now = Date.now();
  const states = { ...hass.states };
  for (const entity of ENTITIES) {
    const current = states[entity.id];
    const next = stateObject(entity, now);
    if (!current || current.state !== next.state) states[entity.id] = next;
  }
  return { ...hass, states };
}
