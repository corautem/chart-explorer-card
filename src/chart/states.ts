import type { EntityConfig } from '../config';
import { seriesColor } from './theme';

/** States that mean "nothing is happening"; they get a neutral shade. */
const QUIET = new Set([
  'off',
  'idle',
  'standby',
  'closed',
  'not_home',
  'locked',
  'stopped',
  'paused',
  'docked',
  'disarmed',
  'false',
  'none',
  'inactive',
  'unplugged',
  'below_horizon',
]);

/** States with no reading; timelines leave them empty. */
export const isMissingState = (state: string | undefined) =>
  state === undefined || state === '' || state === 'unavailable' || state === 'unknown';

export const isQuietState = (state: string) => QUIET.has(state.toLowerCase());

/** True when a band shades this state: the row's on_states, or anything not quiet or missing. */
export function isOnState(row: EntityConfig, state: string | undefined): boolean {
  if (isMissingState(state)) return false;
  if (row.onStates) return row.onStates.includes(state as string);
  return !isQuietState(state as string);
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface StateColorContext {
  /** Colours set for states, such as { standby: '#888888' }. */
  overrides: Readonly<Record<string, string>>;
  entityColor: string;
  neutral: string;
  dark: boolean;
  /** The entity's list of possible states, when it has one. */
  options?: readonly string[];
}

/**
 * The colour of a state, the same on every device and in every window: a
 * colour set for it wins; "on" uses the entity colour and quiet states a
 * neutral shade; states the entity lists as options take palette colours in
 * that order; other states take a palette colour picked from their name, as
 * Home Assistant's history does. Unavailable and unknown have none unless
 * one is set; timelines draw them striped.
 */
export function stateColor(state: string, context: StateColorContext): string | undefined {
  const own = context.overrides[state];
  if (own) return own;
  if (isMissingState(state)) return undefined;
  if (state === 'on') return context.entityColor;
  if (isQuietState(state)) return context.neutral;
  const listed = context.options?.filter((option) => !isQuietState(option) && option !== 'on') ?? [];
  const position = listed.indexOf(state);
  return seriesColor((position >= 0 ? position : hash(state)) % 8, context.dark).color;
}
