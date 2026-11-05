import type { ChartType, EntityType } from './config';
import type { HassEntity } from './ha-types';

/** How a row is drawn on a time axis. */
export type RowKind = 'line' | 'bar' | 'timeline' | 'band';

/**
 * Home Assistant domains whose states are words: on/off, open/closed, modes
 * and the like. Other domains, including ones an add-on makes up for its own
 * entities, are judged like sensors: by unit, state class and state.
 */
const TEXT_DOMAINS = new Set([
  'alarm_control_panel',
  'automation',
  'binary_sensor',
  'button',
  'calendar',
  'camera',
  'climate',
  'cover',
  'device_tracker',
  'event',
  'fan',
  'humidifier',
  'image',
  'input_boolean',
  'input_button',
  'input_datetime',
  'input_select',
  'input_text',
  'lawn_mower',
  'light',
  'lock',
  'media_player',
  'person',
  'remote',
  'scene',
  'schedule',
  'script',
  'select',
  'siren',
  'sun',
  'switch',
  'text',
  'timer',
  'update',
  'vacuum',
  'valve',
  'water_heater',
  'weather',
  'zone',
]);

const isMissing = (state: string) => state === 'unavailable' || state === 'unknown' || state === '';

/**
 * Whether an entity's states are words rather than numbers (on/off entities,
 * modes, and sensors that report a status such as "standby"), judged from its
 * attributes and current state. Undefined when they cannot tell: a sensor with
 * neither a unit nor a state class that is unavailable or unknown right now.
 */
export function textStatesFrom(state: HassEntity | undefined): boolean | undefined {
  if (!state) return false;
  const domain = state.entity_id.split('.')[0];
  if (TEXT_DOMAINS.has(domain)) return true;
  const a = state.attributes;
  if (a.device_class === 'enum' || Array.isArray(a.options)) return true;
  if (a.unit_of_measurement || a.state_class) return false;
  if (isMissing(state.state)) return undefined;
  return !Number.isFinite(Number(state.state));
}

export function hasTextStates(state: HassEntity | undefined): boolean {
  return textStatesFrom(state) ?? false;
}

/** Whether recorded states are words; undefined when only missing states were recorded. */
export function textStatesInHistory(recorded: readonly string[] | undefined): boolean | undefined {
  let numbers = false;
  for (const state of recorded ?? []) {
    if (isMissing(state)) continue;
    if (!Number.isFinite(Number(state))) return true;
    numbers = true;
  }
  return numbers ? false : undefined;
}

/** Whether the entity's states are words, from the entity itself or else from its `recorded` states. */
export function textStates(state: HassEntity | undefined, recorded?: readonly string[]): boolean | undefined {
  return textStatesFrom(state) ?? textStatesInHistory(recorded);
}

/**
 * The row's own choice, or a timeline for text states and the chart's kind for
 * numbers. While neither the entity nor its recorded states can tell, a
 * timeline, so that its history loads with the words.
 */
export function rowKind(
  type: EntityType | undefined,
  chartType: ChartType,
  state: HassEntity | undefined,
  recorded?: readonly string[],
): RowKind {
  if (type && type !== 'auto') return type;
  if (textStates(state, recorded) ?? true) return 'timeline';
  return chartType === 'bar' ? 'bar' : 'line';
}

/** False while the kind is only a first guess that the history may change. */
export function kindSettled(type: EntityType | undefined, state: HassEntity | undefined, recorded?: readonly string[]): boolean {
  return (type !== undefined && type !== 'auto') || textStates(state, recorded) !== undefined;
}

export const isStateKind = (kind: RowKind) => kind === 'timeline' || kind === 'band';
