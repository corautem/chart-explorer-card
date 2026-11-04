// Form definitions for the visual editor, and the conversion between the card
// config and the flat form data that Home Assistant's ha-form edits.

import {
  DEFAULT_QUICK_RANGES,
  legacyValues,
  type AttributeSourceInput,
  type AttributeValueInput,
  type CardConfigInput,
  type EntityConfigInput,
} from '../config';
import { shadeColor, toHex, toRgb } from '../chart/theme';
import { menuLabel } from '../localize';
import { PRESET_IDS, parseRangeItem, rangeItemId, sortRangeItems, type RangeItem } from '../time/range';

export type FormData = Record<string, unknown>;
export type EntityItem = string | EntityConfigInput;

/** Card settings left out of the saved config when they equal these. */
export const DEFAULTS: Readonly<Record<string, unknown>> = {
  chart_type: 'line',
  stacked: false,
  period: 'auto',
  timeline_row_height: 22,
  timeline_names: true,
  timeline_labels: true,
  default_range: '24h',
  toolbar_position: 'top',
  height: 250,
  show_arrows: true,
  show_now_button: true,
  show_range_label: true,
  show_quick_ranges: true,
  show_presets_menu: true,
  show_download: true,
  drag_action: 'pan',
  values_placement: 'above',
  value_position: 'above',
  name_align: 'left',
  values_align: 'left',
  values_gap: 18,
  show_names: true,
  value_size: 22,
  name_size: 12,
  show_now_line: true,
  y_padding_top: 5,
  y_padding_bottom: 5,
  x_padding_left: 0,
  x_padding_right: 0,
  tooltip: false,
  fade_rescale: false,
  x_axis_show: true,
  x_axis_grid: 'none',
  x_axis_label_size: 11,
  y_axis_show: true,
  y_axis_grid: 'dashed',
  y_axis_label_size: 11,
  y_axis_units: false,
  y_axis_zero: false,
  lightweight: true,
  data_source: 'auto',
  statistic: 'auto',
  raw_max_hours: 24,
  five_minute_max_days: 10,
  hourly_max_days: 90,
  csv_separator: ',',
  csv_decimal: '.',
  csv_fill: 'blank',
};

const DEFAULT_FADED_OPACITY = 0.1;

/** The order settings are written back in, so the YAML stays readable. */
const ORDER = [
  'type',
  'title',
  'entities',
  'chart_type',
  'stacked',
  'period',
  'default_range',
  'quick_ranges',
  'unused_quick_ranges',
  'presets',
  'unused_presets',
  'toolbar_position',
  'show_arrows',
  'show_now_button',
  'show_range_label',
  'show_quick_ranges',
  'show_presets_menu',
  'show_download',
  'drag_action',
  'height',
  'values_placement',
  'value_position',
  'name_align',
  'values_align',
  'values_gap',
  'show_names',
  'value_size',
  'name_size',
  'timeline_row_height',
  'timeline_names',
  'timeline_labels',
  'grid_style',
  'show_now_line',
  'now_offset',
  'y_padding_top',
  'y_padding_bottom',
  'x_padding_left',
  'x_padding_right',
  'tooltip',
  'faded_opacity',
  'fade_rescale',
  'x_axis_show',
  'x_axis_grid',
  'x_axis_label_size',
  'y_axis_show',
  'y_axis_grid',
  'y_axis_label_size',
  'y_axis_units',
  'y_axis_zero',
  'y_axes',
  'lightweight',
  'animation',
  'data_source',
  'statistic',
  'raw_max_hours',
  'five_minute_max_days',
  'hourly_max_days',
  'csv_separator',
  'csv_decimal',
  'csv_fill',
];

/** A length of time such as "30m", which the editor's percentage sliders cannot show. */
const isLength = (value: unknown) => typeof value === 'string' && !/^\s*\d+(\.\d+)?\s*%?\s*$/.test(value) && value !== 'none';

const percentOf = (value: unknown) => {
  const n = Number(String(value ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Valid range ids (lengths and presets), without repeats: lengths shortest first, then presets. */
export function tidyRangeItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((text) => parseRangeItem(String(text))).filter((item): item is RangeItem => Boolean(item));
  return sortRangeItems(items).map(rangeItemId);
}

/** Menu entries: presets in their usual order first, then lengths, shortest first. */
export function tidyMenuItems(value: unknown): string[] {
  const ids = tidyRangeItems(value);
  const presets = ids.filter((id) => (PRESET_IDS as readonly string[]).includes(id));
  return [...presets, ...ids.filter((id) => !presets.includes(id))];
}

/** How a range shows in the editor's lists: "Past 45 minutes", "Today". */
export function rangeLabel(id: string): string {
  const item = parseRangeItem(id);
  return item ? menuLabel(item) : id;
}

/** The flat form the editor's fields show: the config with every default filled in. */
export function toForm(config: CardConfigInput): FormData {
  const form: FormData = {
    ...DEFAULTS,
    quick_ranges: [...DEFAULT_QUICK_RANGES],
    presets: [...PRESET_IDS],
    unused_quick_ranges: [],
    unused_presets: [],
  };
  for (const [key, value] of Object.entries(config)) {
    if (key !== 'type' && key !== 'entities' && key !== 'y_axes' && value !== undefined) form[key] = value;
  }
  // now_offset is the older name for the space after the end.
  const right = config.x_padding_right ?? config.now_offset;
  form.x_padding_right = isLength(right) ? 0 : percentOf(right);
  form.x_padding_left = isLength(config.x_padding_left) ? 0 : percentOf(config.x_padding_left);
  form.y_padding_top = config.y_padding_top === undefined ? 5 : percentOf(config.y_padding_top);
  form.y_padding_bottom = config.y_padding_bottom === undefined ? 5 : percentOf(config.y_padding_bottom);
  // grid_style is the older name for the horizontal grid lines.
  if (config.y_axis_grid === undefined && config.grid_style !== undefined) form.y_axis_grid = config.grid_style;
  form.animation = config.animation ?? !(config.lightweight ?? true);
  // Shown as a percentage, saved as a fraction.
  form.faded_opacity = Math.round(Number(config.faded_opacity ?? DEFAULT_FADED_OPACITY) * 100);
  return form;
}

/**
 * Back to a tidy config: values equal to their defaults are left out, keys
 * keep a readable order, and options the editor does not show survive.
 */
export function fromForm(form: FormData, original: CardConfigInput, entities: EntityItem[]): CardConfigInput {
  const out: Record<string, unknown> = { type: original.type ?? 'custom:chart-explorer-card' };
  if (typeof form.title === 'string' && form.title.trim()) out.title = form.title;
  out.entities = entities;

  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = form[key];
    if (!isBlank(value) && !same(value, fallback)) out[key] = value;
  }

  const toolbar = tidyRangeItems(form.quick_ranges ?? DEFAULT_QUICK_RANGES);
  if (!same(toolbar, tidyRangeItems(DEFAULT_QUICK_RANGES))) out.quick_ranges = toolbar;
  const menu = tidyMenuItems(form.presets ?? PRESET_IDS);
  if (!same(menu, [...PRESET_IDS])) out.presets = menu;
  // Custom lengths switched off: kept so the editor can offer them again.
  for (const [key, list] of [
    ['unused_quick_ranges', toolbar],
    ['unused_presets', menu],
  ] as const) {
    const unused = tidyRangeItems(form[key]).filter((id) => !list.includes(id));
    if (unused.length) out[key] = unused;
  }

  const opacity = Number(form.faded_opacity) / 100;
  if (Number.isFinite(opacity) && Math.abs(opacity - DEFAULT_FADED_OPACITY) > 0.001) {
    out.faded_opacity = Math.round(opacity * 100) / 100;
  }
  // Animation is written only when it differs from what lightweight mode implies.
  const lightweight = out.lightweight === undefined ? true : Boolean(out.lightweight);
  if (typeof form.animation === 'boolean' && form.animation === lightweight) out.animation = form.animation;

  // Lengths of time set in YAML stay when the slider was left alone.
  const originalRight = original.x_padding_right ?? original.now_offset;
  if (!out.x_padding_right && isLength(originalRight)) out.x_padding_right = originalRight;
  if (!out.x_padding_left && isLength(original.x_padding_left)) out.x_padding_left = original.x_padding_left;
  // Fixed ranges are YAML-only now; keep them as written.
  if (original.y_axes?.length) out.y_axes = original.y_axes;

  for (const [key, value] of Object.entries(original)) {
    if (!(key in out) && !ORDER.includes(key) && key !== 'recorder_days') out[key] = value;
  }
  const ordered: Record<string, unknown> = {};
  for (const key of ORDER) if (key in out) ordered[key] = out[key];
  for (const [key, value] of Object.entries(out)) if (!(key in ordered)) ordered[key] = value;
  return ordered as CardConfigInput;
}

// ---- Entities ----

const ENTITY_DEFAULTS = { curve: 'smooth', width: 2, fill: false, show_in_header: true, show_unit: true, show_name: true };
// state_colors is not listed: the state colour form edits it, and the main form keeps it as it is.
const ENTITY_KEYS = [
  'entity',
  'multiply',
  'divide_by',
  'add',
  'min_divisor',
  'attribute',
  'type',
  'on_states',
  'name',
  'color',
  'unit',
  'curve',
  'line_style',
  'fill',
  'fill_opacity',
  'width',
  'y_axis',
  'decimals',
  'show_in_header',
  'show_name',
  'show_unit',
  'faded',
  'statistic',
];

export function entityId(item: EntityItem): string {
  return typeof item === 'string' ? item : item.entity;
}

/** Form data for one entity, with its current (or default) colour as RGB. */
export function entityToForm(item: EntityItem, defaultColor: string): FormData {
  const e: EntityConfigInput = typeof item === 'string' ? { entity: item } : item;
  const source = typeof e.attribute === 'string' ? { name: e.attribute } : e.attribute;
  return {
    ...ENTITY_DEFAULTS,
    ...e,
    attribute: undefined,
    divide_by: e.divide_by === undefined ? [] : [e.divide_by].flat(),
    add: e.add === undefined ? [] : [e.add].flat(),
    attribute_name: source?.name ?? '',
    attribute_time: source?.time ?? 'auto',
    fill_opacity: e.fill_opacity === undefined ? undefined : Math.round(e.fill_opacity * 100),
    color: toRgb(e.color ?? defaultColor) ?? toRgb(defaultColor),
    line_style: e.line_style ?? 'auto',
    y_axis: e.y_axis ?? 'auto',
    statistic: e.statistic ?? 'auto',
    type: e.type ?? 'auto',
    on_states: e.on_states ?? [],
  };
}

/** Back to the shortest config for one entity: a plain ID when nothing else is set. */
export function entityFromForm(form: FormData, original: EntityItem, defaultColor: string): EntityItem {
  const base: Record<string, unknown> = typeof original === 'string' ? {} : { ...original };
  const out: Record<string, unknown> = { entity: String(form.entity ?? entityId(original)) };
  if (typeof form.attribute_name === 'string' && form.attribute_name) {
    // The values to draw are edited in their own section; a different attribute starts afresh.
    const before = base.attribute;
    const previous: AttributeSourceInput | undefined = typeof before === 'string' ? { name: before } : (before as AttributeSourceInput | undefined);
    const next: AttributeSourceInput = previous?.name === form.attribute_name ? { ...previous } : { name: form.attribute_name };
    if (form.attribute_time && form.attribute_time !== 'auto') next.time = String(form.attribute_time);
    else delete next.time;
    out.attribute = Object.keys(next).length === 1 ? next.name : next;
  }
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : []);
  const divideBy = list(form.divide_by);
  if (divideBy.length && !out.attribute) {
    out.divide_by = divideBy.length === 1 ? divideBy[0] : divideBy;
    const add = list(form.add);
    if (add.length) out.add = add.length === 1 ? add[0] : add;
    if (typeof form.min_divisor === 'number' && Number.isFinite(form.min_divisor)) out.min_divisor = form.min_divisor;
  }
  if (form.type && form.type !== 'auto' && !out.attribute) out.type = form.type;
  if (typeof form.name === 'string' && form.name.trim()) out.name = form.name;
  if (Array.isArray(form.color)) {
    const hex = toHex(form.color as number[]);
    const defaultHex = toHex(toRgb(defaultColor) ?? [0, 0, 0]);
    if (hex !== defaultHex) out.color = hex;
  }
  if (typeof form.unit === 'string' && form.unit.trim()) out.unit = form.unit;
  if (form.curve && form.curve !== ENTITY_DEFAULTS.curve) out.curve = form.curve;
  if (form.line_style && form.line_style !== 'auto') out.line_style = form.line_style;
  if (form.fill === true) out.fill = true;
  if (form.fill === true && typeof form.fill_opacity === 'number' && Number.isFinite(form.fill_opacity)) {
    out.fill_opacity = Math.min(100, Math.max(0, form.fill_opacity)) / 100;
  }
  if (typeof form.width === 'number' && form.width !== ENTITY_DEFAULTS.width) out.width = form.width;
  if (form.y_axis && form.y_axis !== 'auto') out.y_axis = form.y_axis;
  if (typeof form.decimals === 'number' && Number.isFinite(form.decimals)) out.decimals = form.decimals;
  if (typeof form.multiply === 'number' && Number.isFinite(form.multiply) && form.multiply !== 0 && form.multiply !== 1) {
    out.multiply = form.multiply;
  }
  if (form.show_in_header === false) out.show_in_header = false;
  if (form.show_name === false) out.show_name = false;
  if (form.show_unit === false) out.show_unit = false;
  // Not shown in the editor, but kept when set in YAML.
  if (form.faded === true) out.faded = true;
  if (form.statistic && form.statistic !== 'auto') out.statistic = form.statistic;
  if (Array.isArray(form.on_states) && form.on_states.length) out.on_states = form.on_states;
  for (const [key, value] of Object.entries(base)) {
    if (!ENTITY_KEYS.includes(key)) out[key] = value;
  }
  return Object.keys(out).length === 1 ? (out.entity as string) : (out as unknown as EntityConfigInput);
}

// ---- Labels, explanations and field definitions ----

export const LABELS: Record<string, string> = {
  title: 'Title',
  chart_type: 'Chart type',
  stacked: 'Stack the bars',
  period: 'Length of each bar',
  timeline_row_height: 'Strip height',
  timeline_names: 'Names above the strips',
  timeline_labels: 'States written inside the strips',
  type: 'Draw as',
  on_states: 'States that shade the band',
  default_range: 'Starting window',
  toolbar_position: 'Toolbar position',
  height: 'Chart height',
  values_placement: 'Values row',
  value_position: 'Value position',
  name_align: 'Name alignment',
  value_size: 'Value text size',
  name_size: 'Name text size',
  x_axis_grid: 'Vertical grid lines',
  y_axis_grid: 'Horizontal grid lines',
  show_now_line: 'Line at the present time',
  show_arrows: 'Previous and next arrows',
  show_now_button: 'Now button',
  show_range_label: 'Dates and times',
  show_quick_ranges: 'Quick ranges (1h, 6h…)',
  show_presets_menu: 'Presets menu',
  show_download: 'Download button',
  drag_action: 'Dragging the chart',
  values_align: 'Row alignment',
  values_gap: 'Space between values',
  y_padding_top: 'Space above the highest value',
  y_padding_bottom: 'Space below the lowest value',
  x_padding_left: 'Space before the start',
  x_padding_right: 'Space after the end',
  tooltip: 'Floating tooltip beside the cursor',
  faded_opacity: 'Faded line opacity',
  fade_rescale: 'Rescale the axis when a line is faded',
  x_axis_show: 'Show time labels',
  x_axis_label_size: 'Time label size',
  y_axis_show: 'Show value labels',
  y_axis_label_size: 'Value label size',
  y_axis_units: 'Show units above the axes',
  y_axis_zero: 'Always include zero',
  lightweight: 'Lightweight mode',
  animation: 'Animations',
  data_source: 'Data source',
  raw_max_hours: 'Every recorded change for windows up to',
  five_minute_max_days: '5-minute averages for windows up to',
  hourly_max_days: 'Hourly averages for windows up to',
  csv_separator: 'Separator',
  csv_decimal: 'Decimal mark',
  csv_fill: 'Cells without a point',
  entity: 'Entity',
  name: 'Name',
  color: 'Colour',
  width: 'Line width',
  curve: 'Line shape',
  line_style: 'Line type',
  fill: 'Fill under the line',
  fill_opacity: 'Fill opacity',
  multiply: 'Multiply by',
  divide_by: 'Divide by',
  add: 'Add to this meter',
  min_divisor: 'Smallest divisor',
  attribute_name: 'Draw from',
  attribute_time: 'Time in each item',
  unit: 'Unit',
  decimals: 'Decimal places',
  y_axis: 'Scale (y-axis)',
  statistic: 'Value drawn on long windows',
  show_in_header: 'Show the value above the chart',
  show_name: 'Show the name with the value',
  show_names: 'Show names',
  show_unit: 'Show the unit',
};

export const HELPERS: Record<string, string> = {
  chart_type:
    'Lines and bars share the time axis with a timeline strip for each entity with text or on/off states. A pie shows each entity\'s total (meters) or average over the window, and for an entity with states the time spent in each. A heatmap shows the first entity that is not faded, hour by hour (tap names to choose): numbers by value, states by the state that held longest in each hour.',
  stacked: 'Bars on the same scale stand on top of each other instead of side by side.',
  period: 'Automatic uses hours for windows up to two days, then days, weeks (up to about six months) and months. Meters show how much they rose in each bar; other entities their average.',
  timeline_row_height: 'Height of each strip in pixels.',
  timeline_names: 'The entity name above each strip, so strips can be told apart.',
  timeline_labels: 'The state, such as Standby, inside each part of a strip that is wide enough.',
  type: 'Automatic draws numbers as lines (bars in a bar chart) and text or on/off states, such as a heat pump status, as a timeline strip under the chart. A band shades the chart behind the lines while the entity is on.',
  on_states: 'Leave empty to shade every state except off, idle, standby and the like.',
  default_range: 'The window the card opens with: any quick range, menu entry or preset.',
  toolbar_position: 'Where the time controls and the download button sit.',
  height: 'Height of the chart area in pixels, without the toolbar and values.',
  values_placement: 'Above or below the chart.',
  value_position: 'Where each value sits relative to its entity name.',
  name_align: 'How each name lines up with its value when one sits above the other.',
  faded_opacity: 'How visible a line stays after you tap its name.',
  show_range_label: 'The window shown, such as Mon 26 Oct 00:00 - Sun 1 Nov 23:59. Turned off, its space stays empty for a clean look; Custom… stays in the Presets menu.',
  show_quick_ranges: 'At the top of the Presets menu.',
  show_presets_menu: 'Holds the quick ranges (1h, 6h…), the menu entries and Custom…; turned off, none of them are shown.',
  show_download: 'CSV and PNG export.',
  drag_action: 'Pinch, or Ctrl + mouse wheel, zooms either way, and Shift + drag selects a part. Double-click or double-tap goes back to the window picked in the toolbar.',
  values_align: 'How the entities spread across the card. Spread puts the first and last at the edges; evenly spaced leaves the same room around each.',
  values_gap: 'Gap in pixels between one entity and the next.',
  show_names: 'The entity names with the values. Tapping a name fades its entity, so without names an entity cannot be faded by tapping; hovering a value still shows whose it is.',
  show_name: 'Turned off, only the value or state shows. Tapping the name is what fades the entity, so it cannot be faded by tapping without it.',
  y_padding_top: 'A share of the value range left empty at the top. 0 puts the highest value on the top edge.',
  y_padding_bottom: 'A share of the value range left empty at the bottom. 0 puts the lowest value on the bottom edge.',
  x_padding_left: 'A share of the time window left empty at the left edge.',
  x_padding_right: 'A share of the time window left empty at the right edge. On rolling windows such as 24h the end is the present, so this brings the line at the present into view.',
  fade_rescale: 'When on, the y-axis fits the lines that are not faded; the faded ones may run off the chart.',
  tooltip: 'A box beside the cursor line listing the values at that time. With it on, the values row keeps showing the current values; with it off, the values row follows the cursor.',
  x_axis_grid: 'Lines up the chart at each time label.',
  y_axis_grid: 'Lines across the chart at each value label.',
  y_axis_units: 'Writes the unit, such as °C or W, at the top of each axis.',
  y_axis_zero: 'Each axis starts at zero instead of fitting the values closely.',
  lightweight: 'No animations, and live updates redraw the chart at most every 10 seconds. Saves processor time and battery on tablets and phones.',
  animation: 'Smooth transitions when the chart changes. Follows lightweight mode unless you change it here.',
  data_source: 'Automatic uses every recorded change for short windows and averages for long ones. Always raw history shows every change but loads more data; always statistics loads less but averages each period.',
  raw_max_hours: 'Longer windows switch to averages. Higher values show more detail and load more data from Home Assistant.',
  five_minute_max_days: 'Home Assistant keeps 5-minute averages only as long as raw history; older parts use hourly averages.',
  hourly_max_days: 'Longer windows use daily averages, and weekly averages beyond three years.',
  csv_separator: 'Comma suits most programs; Excel set up for European formats expects a semicolon.',
  csv_decimal: 'Use a comma with the semicolon separator for European Excel.',
  csv_fill: 'Blank keeps only the recorded points. Repeat fills each empty cell with that entity\'s last value, which suits Excel charts and formulas.',
  unit: 'Leave empty to use the entity unit. For a list from an attribute it starts as kW when the entity reports kWh (forecast slots hold power), and otherwise has none.',
  show_unit: 'The unit, such as °C, after the value above the chart and in the tooltip.',
  decimals: 'Leave empty to use the entity display precision; a list from an attribute then shows up to two decimal places.',
  line_style: 'Automatic is a solid line; from the ninth entity on, lines are dashed so colours can repeat. None leaves only the fill or the shaded range.',
  fill_opacity: 'Leave empty for a fill that fades downwards; a percentage gives an even fill at that opacity.',
  attribute_name: 'The recorded history, or a list kept in one of the entity\'s attributes, such as a solar forecast or electricity prices. A list is drawn as it is now, including times still to come.',
  multiply:
    'Multiplies every value of this entity, for a unit the card cannot convert, such as 1000 to show a sensor in kW as W; set the unit to match. W and kW, Wh and kWh are converted without it. Leave empty for none.',
  divide_by:
    'Makes this meter a ratio: its rise in each period divided by the rise of these meters, added together. A heat pump\'s heat delivered divided by its electricity used gives its COP. Wh and kWh convert; the ratio has no unit unless you set one, such as COP.',
  add: 'Meters whose rise is added to this one\'s before dividing, such as hot water to space heating.',
  min_divisor:
    'Periods where the divisor rose less than this, in its unit, stay empty, so a nearly idle day shows no absurd ratio. Leave empty for 50 Wh (0.05 kWh); other units count anything above zero.',
  attribute_time: 'The key holding each item\'s time. It is found automatically when it is called period_start, start, datetime, time and the like.',
  y_axis: 'Entities with different units cannot share one scale: 1,500 W would squash a 20 °C line flat. Automatic puts the first unit on the left-hand scale and the second on the right-hand scale. Choose Left or Right to put this entity on that scale yourself.',
  statistic: 'For every entity: windows longer than 24 hours keep one point per 5 minutes, hour or day, with its average, lowest and highest value. Highest keeps short peaks visible; lowest shows the dips. Energy and water meters always show their reading. An entity can choose differently in its own Advanced section.',
};

type Option = [value: string, label: string];

const select = (options: Option[], extra: Record<string, unknown> = {}) => ({
  select: { mode: 'dropdown', options: options.map(([value, label]) => ({ value, label })), ...extra },
});

// Rows pair only fields of the same kind (two dropdowns, or two text or number
// boxes); sliders and switches get their own row. Home Assistant draws those
// kinds at different heights, so mixed pairs do not line up.
const grid = (...schema: unknown[]) => ({ type: 'grid', name: '', schema });

const number = (min: number, max: number, step: number, unit?: string, mode = 'box') => ({
  number: { min, max, step, mode, ...(unit ? { unit_of_measurement: unit } : {}) },
});

export function generalSchema(form: FormData): unknown[] {
  const ids = [...new Set([...tidyRangeItems(form.quick_ranges), ...tidyRangeItems(form.presets), ...PRESET_IDS])];
  return [
    { name: 'title', selector: { text: {} } },
    {
      name: 'chart_type',
      selector: select([
        ['line', 'Lines'],
        ['area', 'Stacked areas'],
        ['bar', 'Bars'],
        ['pie', 'Pie'],
        ['donut', 'Donut'],
        ['heatmap', 'Heatmap (hour by day)'],
      ]),
    },
    { name: 'default_range', selector: select(ids.map((id): Option => [id, rangeLabel(id)])) },
    {
      name: 'drag_action',
      selector: select([
        ['pan', 'Moves the time window'],
        ['zoom', 'Selects a part to zoom into'],
      ]),
    },
  ];
}

export const LAYOUT_SCHEMA: unknown[] = [
  {
    name: 'toolbar_position',
    selector: select([
      ['top', 'Top of the card'],
      ['bottom', 'Bottom of the card'],
      ['off', 'Off (no toolbar)'],
    ]),
  },
  { name: 'show_arrows', selector: { boolean: {} } },
  { name: 'show_now_button', selector: { boolean: {} } },
  { name: 'show_range_label', selector: { boolean: {} } },
  { name: 'show_quick_ranges', selector: { boolean: {} } },
  { name: 'show_presets_menu', selector: { boolean: {} } },
  { name: 'show_download', selector: { boolean: {} } },
];

export const VALUES_SCHEMA: unknown[] = [
  grid(
    { name: 'values_placement', selector: select([['above', 'Above the chart'], ['below', 'Below the chart']]) },
    {
      name: 'values_align',
      selector: select([
        ['left', 'Left'],
        ['center', 'Centred'],
        ['right', 'Right'],
        ['spread', 'Spread to both edges'],
        ['even', 'Evenly spaced'],
      ]),
    },
  ),
  grid(
    {
      name: 'value_position',
      selector: select([
        ['above', 'Above the name'],
        ['below', 'Below the name'],
        ['left', 'Left of the name'],
        ['right', 'Right of the name'],
      ]),
    },
    { name: 'name_align', selector: select([['left', 'Left'], ['center', 'Centred'], ['right', 'Right']]) },
  ),
  grid({ name: 'value_size', selector: number(10, 64, 1, 'px') }, { name: 'name_size', selector: number(8, 40, 1, 'px') }),
  { name: 'values_gap', selector: number(0, 120, 2, 'px') },
  { name: 'show_names', selector: { boolean: {} } },
];

const GRID_OPTIONS: Option[] = [
  ['dashed', 'Dashed'],
  ['solid', 'Solid'],
  ['none', 'None'],
];

export const CHART_SCHEMA: unknown[] = [
  { name: 'faded_opacity', selector: number(0, 100, 5, '%', 'slider') },
  { name: 'show_now_line', selector: { boolean: {} } },
  { name: 'tooltip', selector: { boolean: {} } },
  { name: 'fade_rescale', selector: { boolean: {} } },
];

export const X_AXIS_SCHEMA: unknown[] = [
  { name: 'x_axis_show', selector: { boolean: {} } },
  { name: 'x_axis_label_size', selector: number(8, 24, 1, 'px') },
  { name: 'x_axis_grid', selector: select(GRID_OPTIONS) },
];

export const Y_AXIS_SCHEMA: unknown[] = [
  { name: 'y_axis_show', selector: { boolean: {} } },
  { name: 'y_axis_units', selector: { boolean: {} } },
  { name: 'y_axis_zero', selector: { boolean: {} } },
  { name: 'y_axis_label_size', selector: number(8, 24, 1, 'px') },
  { name: 'y_axis_grid', selector: select(GRID_OPTIONS) },
];

export const SPACE_SCHEMA: unknown[] = [
  { name: 'height', selector: number(80, 1200, 10, 'px') },
  { name: 'y_padding_top', selector: number(0, 50, 1, '%', 'slider') },
  { name: 'y_padding_bottom', selector: number(0, 50, 1, '%', 'slider') },
  { name: 'x_padding_left', selector: number(0, 30, 1, '%', 'slider') },
  { name: 'x_padding_right', selector: number(0, 30, 1, '%', 'slider') },
];

export const BARS_SCHEMA: unknown[] = [
  {
    name: 'period',
    selector: select([
      ['auto', 'Automatic'],
      ['hour', 'One hour'],
      ['day', 'One day'],
      ['week', 'One week'],
      ['month', 'One month'],
    ]),
  },
  { name: 'stacked', selector: { boolean: {} } },
];

export const TIMELINE_SCHEMA: unknown[] = [
  { name: 'timeline_row_height', selector: number(8, 80, 1, 'px') },
  { name: 'timeline_names', selector: { boolean: {} } },
  { name: 'timeline_labels', selector: { boolean: {} } },
];

export const PERFORMANCE_SCHEMA: unknown[] = [
  { name: 'lightweight', selector: { boolean: {} } },
  { name: 'animation', selector: { boolean: {} } },
];

export const DATA_SCHEMA: unknown[] = [
  {
    name: 'data_source',
    selector: select([
      ['auto', 'Automatic'],
      ['history', 'Always raw history'],
      ['statistics', 'Always statistics'],
    ]),
  },
  { name: 'raw_max_hours', selector: number(1, 24 * 60, 1, 'hours') },
  { name: 'five_minute_max_days', selector: number(1, 60, 1, 'days') },
  { name: 'hourly_max_days', selector: number(1, 3650, 1, 'days') },
];

export const STATISTIC_SCHEMA: unknown[] = [
  {
    name: 'statistic',
    selector: select([
      ['auto', 'Automatic (average)'],
      ['mean', 'Average in each period'],
      ['min', 'Lowest in each period'],
      ['max', 'Highest in each period'],
    ]),
  },
];

export const CSV_SCHEMA: unknown[] = [
  grid(
    { name: 'csv_separator', selector: select([[',', 'Comma ( , )'], [';', 'Semicolon ( ; )'], ['tab', 'Tab']]) },
    { name: 'csv_decimal', selector: select([['.', 'Point ( . )'], [',', 'Comma ( , )']]) },
  ),
  { name: 'csv_fill', selector: select([['blank', 'Leave blank'], ['previous', 'Repeat the last value']]) },
];

export const ADD_ENTITY_SCHEMA: unknown[] = [{ name: 'entity', selector: { entity: {} } }];

/** Explanations on the entity page where they differ from the card-wide ones. */
export const ENTITY_HELPERS: Record<string, string> = {
  statistic:
    'Same as the card follows the Advanced tab. Highest keeps short peaks visible on long windows; lowest shows the dips. Meter reading is for energy and water meters only; lowest and highest are for measurements only.',
};

const KIND_NAMES: Record<string, string> = { line: 'line', bar: 'bars', timeline: 'timeline strip', band: 'band' };

/**
 * The entity page: what every row has, then the settings for how it is drawn.
 * `autoKind` is what Automatic means for this entity; `states` are its known
 * states, offered for bands.
 */
/** The entity's attributes that hold lists, and what the editor needs to know about the chosen one. */
export interface ListSource {
  attributes: string[];
  /** All keys of the chosen list's items, for the time picker. */
  keys: string[];
  chosen: string;
  /** False when the time key could not be found automatically, so it must be picked. */
  showTime?: boolean;
}

// ---- Values drawn from an attribute's list ----

const VALUE_FIELDS = ['on', 'name', 'color', 'line', 'fill', 'opacity', 'show'] as const;

/** The default colour of the k-th value drawn: the entity's colour, then shades of it towards grey. */
export function valueColor(entityColor: string, k: number): string {
  return k === 0 ? entityColor : shadeColor(entityColor, k);
}

/**
 * The values an entity draws from its attribute, as a values list. The older
 * forms become one: an attribute name alone draws the automatic value, and
 * `value`, `low` and `high` a value with a shaded range.
 */
export function attributeValues(e: EntityConfigInput, automatic?: string): AttributeValueInput[] {
  const source = typeof e.attribute === 'string' ? { name: e.attribute } : e.attribute;
  if (!source) return [];
  if (source.values?.length) return source.values;
  const values = legacyValues(source, e);
  if (!values[0].key) {
    if (!automatic) return values.slice(1);
    values[0] = { ...values[0], key: automatic };
  }
  return values;
}

/** Form data for the values section: for each number in the items, whether it is drawn and how. */
export function valuesToForm(values: AttributeValueInput[], keys: string[], entityColor: string): FormData {
  const form: FormData = {};
  for (const key of keys) {
    const k = values.findIndex((value) => value.key === key);
    const value = values[k];
    form[`on:${key}`] = Boolean(value);
    if (!value) continue;
    form[`name:${key}`] = value.name ?? '';
    form[`color:${key}`] = toRgb(value.color ?? valueColor(entityColor, k));
    form[`line:${key}`] = value.line_style ?? 'solid';
    form[`fill:${key}`] = value.fill === true ? 'zero' : typeof value.fill === 'string' ? value.fill : 'none';
    form[`opacity:${key}`] = value.fill_opacity === undefined ? undefined : Math.round(value.fill_opacity * 100);
    form[`show:${key}`] = value.show_in_header ?? true;
  }
  return form;
}

/** The values list from the section's form data, saving only what differs from the defaults. */
export function valuesFromForm(form: FormData, keys: string[], previous: AttributeValueInput[], entityColor: string): AttributeValueInput[] {
  const out: AttributeValueInput[] = [];
  for (const key of keys) {
    if (!form[`on:${key}`]) continue;
    const before = previous.find((value) => value.key === key);
    const value: AttributeValueInput = { key };
    const name = form[`name:${key}`];
    if (typeof name === 'string' && name.trim()) value.name = name;
    const rgb = form[`color:${key}`];
    if (Array.isArray(rgb)) {
      const hex = toHex(rgb as number[]);
      if (hex !== toHex(toRgb(valueColor(entityColor, out.length)) ?? [0, 0, 0])) value.color = hex;
    }
    const line = form[`line:${key}`];
    if (line && line !== 'solid') value.line_style = line as AttributeValueInput['line_style'];
    if (before?.curve) value.curve = before.curve;
    if (before?.width) value.width = before.width;
    const fill = form[`fill:${key}`];
    if (fill && fill !== 'none') {
      value.fill = String(fill);
      const opacity = form[`opacity:${key}`];
      if (typeof opacity === 'number' && Number.isFinite(opacity)) value.fill_opacity = Math.min(100, Math.max(0, opacity)) / 100;
    }
    if (form[`show:${key}`] === false) value.show_in_header = false;
    out.push(value);
  }
  // Values for keys the list does not hold right now are kept as they are.
  for (const value of previous) if (!keys.includes(value.key)) out.push(value);
  return out;
}

/** The fields for each number in the items: a switch, and once it is on its name, colour, line type and fill. */
export function attributeValuesSchema(keys: string[], form: FormData): unknown[] {
  const schema: unknown[] = [];
  for (const key of keys) {
    schema.push({ name: `on:${key}`, selector: { boolean: {} } });
    if (!form[`on:${key}`]) continue;
    const fills: [string, string][] = [
      ['none', 'No fill'],
      ['zero', 'Down to zero'],
      ...keys.filter((other) => other !== key).map((other): [string, string] => [other, `Up to ${other}`]),
    ];
    schema.push(
      grid({ name: `name:${key}`, selector: { text: {} } }, { name: `color:${key}`, selector: { color_rgb: {} } }),
      grid(
        { name: `line:${key}`, selector: select([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['none', 'None']]) },
        { name: `fill:${key}`, selector: select(fills) },
      ),
    );
    if (form[`fill:${key}`] && form[`fill:${key}`] !== 'none') schema.push({ name: `opacity:${key}`, selector: number(0, 100, 5, '%') });
    schema.push({ name: `show:${key}`, selector: { boolean: {} } });
  }
  return schema;
}

/** Labels for the values section's fields, which carry their key after a colon. */
export function valueFieldLabel(name: string): string {
  const [field, key] = name.split(/:(.*)/s);
  const labels: Record<(typeof VALUE_FIELDS)[number], string> = {
    on: key,
    name: 'Name',
    color: 'Colour',
    line: 'Line type',
    fill: 'Fill',
    opacity: 'Fill opacity',
    show: 'Show the value above the chart',
  };
  return labels[field as (typeof VALUE_FIELDS)[number]] ?? name;
}

export function entitySchema(
  kind = 'line',
  autoKind = 'line',
  states: string[] = [],
  list: ListSource = { attributes: [], keys: [], chosen: '' },
  ratio = false,
): unknown[] {
  const numeric = kind === 'line' || kind === 'bar';
  const names = list.chosen && !list.attributes.includes(list.chosen) ? [...list.attributes, list.chosen] : list.attributes;
  const keyOptions = (first: [string, string]) => select([first, ...list.keys.map((key): [string, string] => [key, key])]);
  const schema: unknown[] = [
    { name: 'entity', required: true, selector: { entity: {} } },
    grid({ name: 'name', selector: { text: {} } }, { name: 'color', selector: { color_rgb: {} } }),
  ];
  // A meter can become a ratio; a list from an attribute cannot.
  if (!list.chosen && numeric) {
    schema.push({ name: 'divide_by', selector: { entity: { multiple: true } } });
    if (ratio) schema.push({ name: 'add', selector: { entity: { multiple: true } } }, { name: 'min_divisor', selector: number(0, 1_000_000, 0.01) });
  }
  if (names.length && !ratio) {
    schema.push({
      name: 'attribute_name',
      selector: select([['', 'Recorded history'], ...names.map((name): [string, string] => [name, `Attribute: ${name}`])]),
    });
  }
  if (list.chosen) {
    if (list.showTime) schema.push({ name: 'attribute_time', selector: keyOptions(['auto', 'Automatic']) });
  } else {
    schema.push({
      name: 'type',
      selector: select([
        ['auto', `Automatic (${KIND_NAMES[autoKind] ?? autoKind})`],
        ['line', 'Line'],
        ['bar', 'Bars'],
        ...(ratio
          ? []
          : ([
              ['timeline', 'Timeline strip'],
              ['band', 'Band behind the lines'],
            ] as [string, string][])),
      ]),
    });
  }
  const curve = { name: 'curve', selector: select([['smooth', 'Smooth'], ['straight', 'Straight'], ['step', 'Steps']]) };
  if (kind === 'line' && list.chosen) {
    // Each value of the list has its own line type and fill, in the Values to draw section.
    schema.push(curve, { name: 'width', selector: number(0.5, 8, 0.5, 'px', 'slider') });
  } else if (kind === 'line') {
    schema.push(
      grid(curve, {
        name: 'line_style',
        selector: select([['auto', 'Automatic'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['none', 'None']]),
      }),
      { name: 'width', selector: number(0.5, 8, 0.5, 'px', 'slider') },
      { name: 'fill', selector: { boolean: {} } },
      { name: 'fill_opacity', selector: number(0, 100, 5, '%') },
    );
  }
  if (kind === 'band') {
    schema.push({
      name: 'on_states',
      selector: { select: { multiple: true, mode: 'list', options: states.map((state) => ({ value: state, label: state })) } },
    });
  }
  schema.push({ name: 'show_in_header', selector: { boolean: {} } }, { name: 'show_name', selector: { boolean: {} } });
  if (numeric) {
    schema.push(
      { name: 'show_unit', selector: { boolean: {} } },
      grid({ name: 'unit', selector: { text: {} } }, { name: 'decimals', selector: number(0, 6, 1) }),
      { name: 'multiply', selector: number(-1_000_000, 1_000_000, 0.001) },
      {
        name: 'y_axis',
        selector: select([['auto', 'Automatic (by unit)'], ['left', 'Left scale'], ['right', 'Right scale']]),
      },
    );
    // A list from an attribute is drawn as it is, and a ratio divides rises, so the choice for long windows does not apply.
    if (!list.chosen && !ratio) {
      schema.push({
        name: 'statistic',
        selector: select([
          ['auto', 'Same as the card (Advanced tab)'],
          ['mean', 'Average in each period'],
          ['min', 'Lowest in each period'],
          ['max', 'Highest in each period'],
          ['state', 'Meter reading'],
        ]),
      });
    }
  }
  return schema;
}

/** One colour picker per known state; `state:` keeps them apart from other settings. */
export function stateColorSchema(states: string[]): unknown[] {
  return states.map((state) => ({ name: `state:${state}`, selector: { color_rgb: {} } }));
}
