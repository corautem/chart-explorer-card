import { fixedLengthMs, parseQuickRange } from './time/duration';
import { PRESET_IDS, parseRangeItem, parseRangeSpec, type RangeItem, type RangeSpec } from './time/range';

export type Curve = 'smooth' | 'straight' | 'step';
export type DataSource = 'auto' | 'history' | 'statistics';
export type GridStyle = 'dashed' | 'solid' | 'none';
export type StatisticKind = 'mean' | 'min' | 'max' | 'state';
/** `none` hides the line, leaving its fill or shaded range. */
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'none';
/** Where each value sits relative to its entity name. */
export type ValuePosition = 'above' | 'below' | 'left' | 'right';
/** How the values row spreads across the card. */
export type ValuesAlign = 'left' | 'center' | 'right' | 'spread' | 'even';
/** What dragging across the chart does. */
export type DragAction = 'pan' | 'zoom';
/** The kind of chart: lines over time (area stacks them), bars per period, pie or donut totals, or an hour-by-day heatmap. */
export type ChartType = 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'heatmap';
/** How one entity is drawn; automatic picks a timeline for text and on/off states. */
export type EntityType = 'auto' | 'line' | 'bar' | 'timeline' | 'band';
/** The length of each bar; automatic picks it from the window. */
export type BarPeriod = 'auto' | 'hour' | 'day' | 'week' | 'month';
/** Empty space at a side of the chart: a share of the range, or a length of time. */
export interface Space {
  percent?: number;
  ms?: number;
}

/**
 * A list kept in an attribute, such as a forecast: each item has a time and a
 * value, and optionally a low and a high value for a shaded range.
 */
export interface AttributeSourceInput {
  name: string;
  time?: string;
  value?: string;
  low?: string;
  high?: string;
}

export interface EntityConfigInput {
  entity: string;
  /** Draw a list from this attribute instead of the recorded history. */
  attribute?: string | AttributeSourceInput;
  name?: string;
  color?: string;
  unit?: string;
  curve?: Curve;
  line_style?: LineStyle;
  fill?: boolean;
  /** 0 to 1: an even fill at this opacity instead of the fading gradient. */
  fill_opacity?: number;
  width?: number;
  y_axis?: string;
  decimals?: number;
  show_in_header?: boolean;
  show_unit?: boolean;
  show_name?: boolean;
  faded?: boolean;
  statistic?: StatisticKind;
  type?: EntityType;
  /** Colours for states, such as { standby: '#888888' }. */
  state_colors?: Record<string, string>;
  /** States that shade a band; by default every state except off, idle, standby and the like. */
  on_states?: string[];
}

export interface YAxisInput {
  id: string;
  min?: number;
  max?: number;
}

export interface CardConfigInput {
  type?: string;
  title?: string;
  entities?: (string | EntityConfigInput)[];
  chart_type?: ChartType;
  /** Bars stack on each other instead of standing side by side. */
  stacked?: boolean;
  period?: BarPeriod;
  timeline_row_height?: number;
  timeline_names?: boolean;
  timeline_labels?: boolean;
  default_range?: string;
  /** Toolbar buttons and menu entries: lengths such as 45m or presets such as today. */
  quick_ranges?: string[];
  presets?: string[];
  height?: number;
  faded_opacity?: number;
  fade_rescale?: boolean;
  tooltip?: boolean;
  lightweight?: boolean;
  animation?: boolean;
  show_now_line?: boolean;
  /** Older name for x_padding_right. */
  now_offset?: string | number;
  y_padding_top?: number | string;
  y_padding_bottom?: number | string;
  x_padding_left?: number | string;
  x_padding_right?: number | string;
  values_align?: ValuesAlign;
  values_gap?: number;
  /** The entity names next to the values; tapping a name fades its entity. */
  show_names?: boolean;
  show_range_label?: boolean;
  show_arrows?: boolean;
  show_now_button?: boolean;
  show_quick_ranges?: boolean;
  show_presets_menu?: boolean;
  show_download?: boolean;
  drag_action?: DragAction;
  /** Older name for y_axis_grid. */
  grid_style?: GridStyle;
  toolbar_position?: 'top' | 'bottom' | 'off';
  values_placement?: 'above' | 'below';
  name_align?: 'left' | 'center' | 'right';
  value_position?: ValuePosition;
  value_size?: number;
  name_size?: number;
  x_axis_show?: boolean;
  x_axis_grid?: GridStyle;
  y_axis_grid?: GridStyle;
  x_axis_label_size?: number;
  y_axis_show?: boolean;
  y_axis_label_size?: number;
  y_axis_units?: boolean;
  y_axis_zero?: boolean;
  csv_separator?: string;
  csv_decimal?: '.' | ',';
  csv_fill?: 'blank' | 'previous';
  data_source?: DataSource;
  /** What long windows show per period for every entity; entities can override it. */
  statistic?: 'mean' | 'min' | 'max';
  raw_max_hours?: number;
  five_minute_max_days?: number;
  hourly_max_days?: number;
  y_axes?: YAxisInput[];
}

export interface AttributeSource {
  name: string;
  /** Keys in each item; without them the time and value keys are found automatically. */
  time?: string;
  value?: string;
  low?: string;
  high?: string;
}

export interface EntityConfig {
  /** Unique per row, so one entity can appear twice. */
  key: string;
  index: number;
  entity: string;
  attribute?: AttributeSource;
  name?: string;
  color?: string;
  unit?: string;
  curve: Curve;
  lineStyle?: LineStyle;
  fill: boolean;
  fillOpacity?: number;
  width: number;
  yAxis?: string;
  decimals?: number;
  showInHeader: boolean;
  showUnit: boolean;
  showName: boolean;
  faded: boolean;
  statistic?: StatisticKind;
  type: EntityType;
  stateColors: Record<string, string>;
  onStates?: string[];
}

export interface DataSettings {
  source: DataSource;
  rawMaxHours: number;
  fiveMinuteMaxDays: number;
  hourlyMaxDays: number;
}

export interface CsvSettings {
  separator: string;
  decimal: '.' | ',';
  fill: 'blank' | 'previous';
}

export interface CardConfig {
  title?: string;
  entities: EntityConfig[];
  chartType: ChartType;
  stacked: boolean;
  period: BarPeriod;
  /** Strips for entities with text or on/off states, under the lines. */
  timeline: { rowHeight: number; names: boolean; labels: boolean };
  defaultRange: RangeSpec;
  quickRanges: RangeItem[];
  presets: RangeItem[];
  height: number;
  fadedOpacity: number;
  fadeRescale: boolean;
  tooltip: boolean;
  lightweight: boolean;
  animation: boolean;
  showNowLine: boolean;
  /** Empty space above the highest and below the lowest value, as fractions of the value range; 0 ends the scale at the value. */
  yPadding: { top: number; bottom: number };
  /** Empty space before the start and after the end of the window. */
  xPadding: { left?: Space; right?: Space };
  valuesAlign: ValuesAlign;
  valuesGap: number;
  showNames: boolean;
  showRangeLabel: boolean;
  /** Which toolbar controls show; with none, the toolbar row goes. */
  toolbar: { arrows: boolean; now: boolean; quickRanges: boolean; presets: boolean; download: boolean };
  dragAction: DragAction;
  toolbarPosition: 'top' | 'bottom' | 'off';
  /** The values row above or below the chart. */
  valuesPlacement: 'above' | 'below';
  /** How each name lines up with its value when one sits above the other. */
  nameAlign: 'left' | 'center' | 'right';
  valuePosition: ValuePosition;
  valueSize: number;
  nameSize: number;
  xAxis: { show: boolean; labelSize: number; grid: GridStyle };
  yAxis: { show: boolean; labelSize: number; units: boolean; zero: boolean; grid: GridStyle };
  csv: CsvSettings;
  data: DataSettings;
  statistic?: 'mean' | 'min' | 'max';
  yAxes: Record<string, { min?: number; max?: number }>;
}

export const DEFAULT_QUICK_RANGES = ['1h', '6h', '12h', '24h', '7d', '30d', '1y'];

const CURVES: Curve[] = ['smooth', 'straight', 'step'];
const GRID_STYLES: GridStyle[] = ['dashed', 'solid', 'none'];
const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted', 'none'];
const STATISTICS: StatisticKind[] = ['mean', 'min', 'max', 'state'];
const CHART_TYPES: ChartType[] = ['line', 'area', 'bar', 'pie', 'donut', 'heatmap'];
const ENTITY_TYPES: EntityType[] = ['auto', 'line', 'bar', 'timeline', 'band'];
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export function normalizeConfig(input: unknown): CardConfig {
  if (!input || typeof input !== 'object') throw new Error('The card configuration is empty.');
  const c = input as CardConfigInput;
  if (!Array.isArray(c.entities) || c.entities.length === 0) {
    throw new Error('Add at least one entity under "entities".');
  }

  const quickRanges = rangeItems(c.quick_ranges ?? DEFAULT_QUICK_RANGES, 'quick_ranges');
  const presets = rangeItems(c.presets ?? [...PRESET_IDS], 'presets');

  const defaultRange = parseRangeSpec(String(c.default_range ?? '24h'));
  if (!defaultRange) {
    throw new Error(
      `default_range: "${c.default_range}" is unknown. Use a length such as 24h or a preset such as today.`,
    );
  }

  const lightweight = bool(c.lightweight, 'lightweight', true);
  const yAxes: CardConfig['yAxes'] = {};
  for (const axis of c.y_axes ?? []) {
    if (!axis || typeof axis.id !== 'string') throw new Error('y_axes: every entry needs an "id".');
    const min = optionalNumber(axis.min, `y_axes ${axis.id} min`);
    const max = optionalNumber(axis.max, `y_axes ${axis.id} max`);
    // A maximum that is not above the minimum would turn the scale upside down; fit instead.
    yAxes[axis.id] = min !== undefined && max !== undefined && max <= min ? {} : { min, max };
  }

  return {
    title: c.title === undefined || c.title === null ? undefined : String(c.title),
    entities: c.entities.map(normalizeEntity),
    chartType: oneOf(c.chart_type, 'chart_type', CHART_TYPES, 'line'),
    stacked: bool(c.stacked, 'stacked', false),
    period: oneOf(c.period, 'period', ['auto', 'hour', 'day', 'week', 'month'], 'auto'),
    timeline: {
      rowHeight: clamp(positiveNumber(c.timeline_row_height, 'timeline_row_height', 22), 8, 80),
      names: bool(c.timeline_names, 'timeline_names', true),
      labels: bool(c.timeline_labels, 'timeline_labels', true),
    },
    defaultRange,
    quickRanges,
    presets,
    height: positiveNumber(c.height, 'height', 250, 80),
    fadedOpacity: clamp(optionalNumber(c.faded_opacity, 'faded_opacity') ?? 0.1, 0, 1),
    fadeRescale: bool(c.fade_rescale, 'fade_rescale', false),
    tooltip: bool(c.tooltip, 'tooltip', false),
    lightweight,
    animation: bool(c.animation, 'animation', !lightweight),
    showNowLine: bool(c.show_now_line, 'show_now_line', true),
    yPadding: {
      top: share(c.y_padding_top, 'y_padding_top', 5),
      bottom: share(c.y_padding_bottom, 'y_padding_bottom', 5),
    },
    xPadding: {
      left: space(c.x_padding_left, 'x_padding_left'),
      right: space(c.x_padding_right ?? c.now_offset, c.x_padding_right === undefined ? 'now_offset' : 'x_padding_right'),
    },
    valuesAlign: oneOf(c.values_align, 'values_align', ['left', 'center', 'right', 'spread', 'even'], 'left'),
    valuesGap: clamp(optionalNumber(c.values_gap, 'values_gap') ?? 18, 0, 120),
    showNames: bool(c.show_names, 'show_names', true),
    showRangeLabel: bool(c.show_range_label, 'show_range_label', true),
    toolbar: {
      arrows: bool(c.show_arrows, 'show_arrows', true),
      now: bool(c.show_now_button, 'show_now_button', true),
      quickRanges: bool(c.show_quick_ranges, 'show_quick_ranges', true),
      presets: bool(c.show_presets_menu, 'show_presets_menu', true),
      download: bool(c.show_download, 'show_download', true),
    },
    dragAction: oneOf(c.drag_action, 'drag_action', ['pan', 'zoom'], 'pan'),
    toolbarPosition: oneOf(c.toolbar_position, 'toolbar_position', ['top', 'bottom', 'off'], 'top'),
    valuesPlacement: oneOf(c.values_placement, 'values_placement', ['above', 'below'], 'above'),
    nameAlign: oneOf(c.name_align, 'name_align', ['left', 'center', 'right'], 'left'),
    valuePosition: oneOf(c.value_position, 'value_position', ['above', 'below', 'left', 'right'], 'above'),
    valueSize: clamp(positiveNumber(c.value_size, 'value_size', 22), 10, 64),
    nameSize: clamp(positiveNumber(c.name_size, 'name_size', 12), 8, 40),
    xAxis: {
      show: bool(c.x_axis_show, 'x_axis_show', true),
      grid: oneOf(c.x_axis_grid, 'x_axis_grid', GRID_STYLES, 'none'),
      labelSize: clamp(positiveNumber(c.x_axis_label_size, 'x_axis_label_size', 11), 8, 24),
    },
    yAxis: {
      show: bool(c.y_axis_show, 'y_axis_show', true),
      grid: oneOf(c.y_axis_grid ?? c.grid_style, 'y_axis_grid', GRID_STYLES, 'dashed'),
      labelSize: clamp(positiveNumber(c.y_axis_label_size, 'y_axis_label_size', 11), 8, 24),
      units: bool(c.y_axis_units, 'y_axis_units', false),
      zero: bool(c.y_axis_zero, 'y_axis_zero', false),
    },
    csv: {
      separator: csvSeparator(c.csv_separator),
      decimal: oneOf(c.csv_decimal, 'csv_decimal', ['.', ','], '.'),
      fill: oneOf(c.csv_fill, 'csv_fill', ['blank', 'previous'], 'blank'),
    },
    data: {
      source: oneOf(c.data_source, 'data_source', ['auto', 'history', 'statistics'], 'auto'),
      rawMaxHours: positiveNumber(c.raw_max_hours, 'raw_max_hours', 24),
      fiveMinuteMaxDays: positiveNumber(c.five_minute_max_days, 'five_minute_max_days', 10),
      hourlyMaxDays: positiveNumber(c.hourly_max_days, 'hourly_max_days', 90),
    },
    statistic:
      c.statistic === undefined ? undefined : oneOf<'mean' | 'min' | 'max'>(c.statistic, 'statistic', ['mean', 'min', 'max'], 'mean'),
    yAxes,
  };
}

function normalizeEntity(raw: string | EntityConfigInput, index: number): EntityConfig {
  const e: EntityConfigInput = typeof raw === 'string' ? { entity: raw } : raw;
  const where = `Entity ${index + 1}`;
  if (!e || typeof e.entity !== 'string' || !ENTITY_ID.test(e.entity)) {
    throw new Error(`${where}: "entity" must be an entity ID such as sensor.outdoor_temperature.`);
  }
  const decimals = optionalNumber(e.decimals, `${where} decimals`);
  return {
    key: `${index}:${e.entity}`,
    index,
    entity: e.entity,
    attribute: attributeSource(e.attribute, `${where} attribute`),
    name: e.name === undefined ? undefined : String(e.name),
    color: e.color === undefined ? undefined : String(e.color),
    unit: e.unit === undefined ? undefined : String(e.unit),
    curve: oneOf(e.curve, `${where} curve`, CURVES, 'smooth'),
    lineStyle: e.line_style === undefined ? undefined : oneOf(e.line_style, `${where} line_style`, LINE_STYLES, 'solid'),
    fill: bool(e.fill, `${where} fill`, false),
    fillOpacity: fillOpacity(e.fill_opacity, `${where} fill_opacity`),
    width: positiveNumber(e.width, `${where} width`, 2),
    yAxis: e.y_axis === undefined ? undefined : String(e.y_axis),
    decimals: decimals === undefined ? undefined : clamp(Math.round(decimals), 0, 10),
    showInHeader: bool(e.show_in_header, `${where} show_in_header`, true),
    showName: bool(e.show_name, `${where} show_name`, true),
    showUnit: bool(e.show_unit, `${where} show_unit`, true),
    faded: bool(e.faded, `${where} faded`, false),
    statistic: e.statistic === undefined ? undefined : oneOf(e.statistic, `${where} statistic`, STATISTICS, 'mean'),
    type: oneOf(e.type, `${where} type`, ENTITY_TYPES, 'auto'),
    stateColors: stateColors(e.state_colors, `${where} state_colors`),
    onStates: e.on_states === undefined ? undefined : stringList(e.on_states, `${where} on_states`),
  };
}

function fillOpacity(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error(`${name} must be between 0 and 1, such as 0.3.`);
  return amount;
}

function attributeSource(value: unknown, name: string): AttributeSource | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return { name: value };
  if (typeof value !== 'object' || Array.isArray(value) || !(value as AttributeSourceInput).name) {
    throw new Error(`${name} must be an attribute name, or { name, time, value, low, high } with the keys in each item.`);
  }
  const input = value as AttributeSourceInput;
  const key = (text: unknown) => (text === undefined || text === null || text === '' ? undefined : String(text));
  return { name: String(input.name), time: key(input.time), value: key(input.value), low: key(input.low), high: key(input.high) };
}

function stateColors(value: unknown, name: string): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must map states to colours, such as standby: "#888888".`);
  }
  const out: Record<string, string> = {};
  for (const [state, color] of Object.entries(value as Record<string, unknown>)) {
    if (color !== undefined && color !== null && color !== '') out[state] = String(color);
  }
  return out;
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list of states.`);
  return value.map((item) => String(item));
}

function rangeItems(list: unknown, name: string): RangeItem[] {
  if (!Array.isArray(list)) throw new Error(`${name} must be a list.`);
  return list.map((text) => {
    const item = parseRangeItem(String(text));
    if (!item) {
      throw new Error(
        `${name}: "${text}" is not a length or a preset. Use a number followed by m, h, d, w, mo or y ` +
          `(such as 45m or 6d), or a preset such as today or last_week.`,
      );
    }
    return item;
  });
}

/** Space at a side of the time axis: "5%" of the window (a plain number is a percentage) or a length such as "1h". */
function space(value: unknown, name: string): Space | undefined {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return undefined;
  const text = String(value).trim();
  if (text === 'none') return undefined;
  const percent = /^(\d+(?:\.\d+)?)\s*%?$/.exec(text);
  if (percent && (text.endsWith('%') || typeof value === 'number' || /^\d+(\.\d+)?$/.test(text))) {
    const amount = Number(percent[1]);
    return amount > 0 ? { percent: Math.min(amount, 50) } : undefined;
  }
  const range = parseQuickRange(text);
  const ms = range ? fixedLengthMs(range) : undefined;
  if (ms) return { ms };
  throw new Error(`${name} must be a share of the window, such as 5%, or a length such as 30m or 1h.`);
}

/** Space above or below the values, as a percentage of the value range (0 to 100), returned as a fraction. */
function share(value: unknown, name: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback / 100;
  const amount = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${name} must be a percentage, such as 10.`);
  return Math.min(amount, 100) / 100;
}

function bool(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false.`);
  return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  return n;
}

function positiveNumber(value: unknown, name: string, fallback: number, minimum = 0): number {
  const n = optionalNumber(value, name);
  if (n === undefined) return fallback;
  if (n <= 0) throw new Error(`${name} must be greater than 0.`);
  return Math.max(n, minimum);
}

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value as T)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function csvSeparator(value: unknown): string {
  if (value === undefined || value === null) return ',';
  const text = String(value);
  if (text === 'tab' || text === '\\t') return '\t';
  if (text.length !== 1 || /["\r\n]/.test(text)) {
    throw new Error('csv_separator must be one character, such as "," or ";" (or "tab").');
  }
  return text;
}
