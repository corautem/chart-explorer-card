import type { CardConfig, Curve, GridStyle, LineStyle } from '../config';
import type { TimeWindow } from '../time/range';
import { toRgb, withAlpha, type Theme } from './theme';

const gridLine = (style: GridStyle, color: string) => ({
  show: style !== 'none',
  lineStyle: { color, type: style === 'dashed' ? [4, 4] : 'solid' },
});

export interface PlotSeries {
  key: string;
  name: string;
  color: string;
  curve: Curve;
  lineStyle: LineStyle;
  fill: boolean;
  /** An even fill at this opacity; without it the fill fades from the line downwards. */
  fillOpacity?: number;
  width: number;
  faded: boolean;
  axisIndex: number;
  /** Already thinned to the chart width; NaN values are gaps. */
  data: { t: number[]; v: number[] };
  /** Lines with the same stack id pile up as areas; their points share timestamps. */
  stack?: string;
  /** A shaded range behind the line, between two values at the same timestamps as `data`. */
  band?: { low: number[]; high: number[]; opacity: number };
}

/** One entity's bars, already placed: each bar spans start to end in time and low to high in value. */
export interface PlotBar {
  key: string;
  color: string;
  faded: boolean;
  axisIndex: number;
  bars: BarShape[];
}

export interface BarShape {
  start: number;
  end: number;
  low: number;
  high: number;
}

/** Shaded stretches behind the lines while an entity is on. */
export interface PlotBand {
  key: string;
  color: string;
  faded: boolean;
  spans: { start: number; end: number }[];
}

/** One strip of the timeline. */
export interface PlotTimelineRow {
  key: string;
  name: string;
  faded: boolean;
  /** Parts with no colour (unavailable or unknown) are drawn striped. */
  segments: { start: number; end: number; color?: string; label: string }[];
}

export interface TimelineSettings {
  rows: PlotTimelineRow[];
  rowHeight: number;
  names: boolean;
  labels: boolean;
  /** Left and right edges of the plot above, in pixels, so the strips line up with it. */
  inset?: { left: number; right: number };
}

export interface PlotAxis {
  position: 'left' | 'right';
  show: boolean;
  unit?: string;
  min?: number;
  max?: number;
  /** Bars stand on zero, so their scale includes it. */
  zero?: boolean;
}

export interface PlotInput {
  window: TimeWindow;
  /** Edges of the time axis: the window plus any space before and after it. */
  axisStart: number;
  axisEnd: number;
  /** Space above the highest and below the lowest value, as fractions of the value range. */
  yPadding: { top: number; bottom: number };
  now: number;
  series: PlotSeries[];
  bars: PlotBar[];
  bands: PlotBand[];
  timeline?: TimelineSettings;
  /** False when every entity is a timeline strip: only the strips are drawn. */
  hasMain: boolean;
  axes: PlotAxis[];
  theme: Theme;
  fadedOpacity: number;
  fadeRescale: boolean;
  animation: boolean;
  showNowLine: boolean;
  xAxis: CardConfig['xAxis'];
  yAxis: CardConfig['yAxis'];
  splitNumber: number;
  axisTime(ms: number): string;
  cursorTime(ms: number): string;
  axisNumber(value: number): string;
}

const NOW_LINE_ID = '__now';
const NAME_SIZE = 11;
const ROW_GAP = 4;

/** Height of the timeline strips in pixels, names included. */
export function timelineHeight(rows: number, rowHeight: number, names: boolean): number {
  return rows ? rows * (rowHeight + ROW_GAP + (names ? NAME_SIZE + 4 : 0)) : 0;
}

/** Room under the plot for the time labels. */
export function timeLabelHeight(xAxis: CardConfig['xAxis']): number {
  return xAxis.show ? xAxis.labelSize + 12 : 4;
}

export function buildOption(input: PlotInput): Record<string, unknown> {
  const { theme, window } = input;
  const font = (size: number) => ({ color: theme.secondaryText, fontSize: size, fontFamily: theme.fontFamily });
  const extents = input.fadeRescale ? brightExtents(input) : [];
  const strips = input.timeline?.rows.length ? input.timeline : undefined;
  const main = input.hasMain || !strips;
  const nowShown =
    input.showNowLine && input.now >= window.start && input.now <= Math.max(window.end + 60_000, input.axisEnd);

  const yAxis: Record<string, unknown>[] = [];
  const series: Record<string, unknown>[] = [];
  const grid: Record<string, unknown>[] = [];
  const xAxis: Record<string, unknown>[] = [];
  const labelRoom = timeLabelHeight(input.xAxis);
  const stripHeight = strips ? timelineHeight(strips.rows.length, strips.rowHeight, strips.names) : 0;
  const top = input.yAxis.units && input.yAxis.show ? 22 : 10;

  const timeAxis = (gridIndex: number, labels: boolean, line: boolean, grid: GridStyle) => ({
    type: 'time',
    gridIndex,
    min: input.axisStart,
    max: input.axisEnd,
    splitNumber: input.splitNumber,
    axisLine: { show: line, lineStyle: { color: theme.divider } },
    axisTick: { show: false },
    axisLabel: {
      ...font(input.xAxis.labelSize),
      show: labels && input.xAxis.show,
      hideOverlap: true,
      formatter: (value: number) => input.axisTime(value),
    },
    splitLine: gridLine(grid, theme.divider),
    axisPointer: {
      show: true,
      snap: false,
      type: 'line',
      triggerTooltip: false,
      lineStyle: { color: theme.secondaryText, width: 1 },
      label: {
        show: labels,
        formatter: (p: { value: number | string }) => input.cursorTime(Number(p.value)),
        color: theme.background,
        backgroundColor: theme.secondaryText,
        fontSize: 11,
        fontFamily: theme.fontFamily,
        padding: [2, 6],
        borderRadius: 4,
      },
    },
  });

  if (main) {
    grid.push({ left: 4, right: 4, top, bottom: strips ? stripHeight + labelRoom + 6 : 4 });
    xAxis.push(timeAxis(0, !strips, true, input.xAxis.grid));
    const padded = paddedBounds(input.yPadding, input.yAxis.zero);
    const paddedZero = paddedBounds(input.yPadding, true);
    input.axes.forEach((axis, i) => {
      const bounds = axis.zero ? paddedZero : padded;
      yAxis.push({
        type: 'value',
        position: axis.position,
        show: axis.show,
        // scale: false makes ECharts include zero.
        scale: !(input.yAxis.zero || axis.zero),
        min: axis.min ?? extents[i]?.min ?? bounds.min,
        max: axis.max ?? extents[i]?.max ?? bounds.max,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          ...font(input.yAxis.labelSize),
          show: input.yAxis.show,
          // Edges set by the space settings fall on odd numbers such as 38.2; label
          // only the round values between them, unless the edge was fixed by hand.
          showMinLabel: axis.min !== undefined,
          showMaxLabel: axis.max !== undefined,
          hideOverlap: true,
          formatter: (value: number) => input.axisNumber(value),
        },
        // Only the first axis draws grid lines, so two scales do not draw two sets.
        splitLine: i === 0 ? gridLine(input.yAxis.grid, theme.divider) : { show: false },
      });
    });
    if (input.bands.length || nowShown) {
      // A hidden 0 to 1 scale for things that span the plot from top to bottom.
      yAxis.push({ type: 'value', show: false, min: 0, max: 1 });
      const full = yAxis.length - 1;
      for (const band of input.bands) series.push(bandSeries(band, full, input));
      if (nowShown) series.push(nowLine(input.now, 0, full, theme));
    }
    for (const bar of input.bars) series.push(barSeries(bar, input));
    for (const line of input.series) if (line.band) series.push(rangeSeries(line, input));
    for (const line of input.series) series.push(lineSeries(line, input));
  }

  if (strips) {
    const gridIndex = grid.length;
    const inset = strips.inset ?? { left: 40, right: 4 };
    grid.push(
      main
        ? { left: inset.left, right: inset.right, bottom: labelRoom, height: stripHeight, outerBoundsMode: 'none' }
        : { left: 4, right: 4, top: 4, bottom: 4 },
    );
    xAxis.push(timeAxis(gridIndex, true, false, 'none'));
    yAxis.push({ type: 'value', gridIndex, show: false, min: 0, max: 1 });
    const axisIndex = yAxis.length - 1;
    series.push(timelineFrame(strips, gridIndex, axisIndex, input));
    strips.rows.forEach((row, r) => series.push(timelineSeries(row, r, strips, gridIndex, axisIndex, input)));
    if (nowShown) series.push({ ...nowLine(input.now, gridIndex, axisIndex, theme), id: `${NOW_LINE_ID}-strips` });
  }

  return {
    animation: input.animation,
    animationDuration: 300,
    animationDurationUpdate: 300,
    textStyle: { fontFamily: theme.fontFamily },
    grid,
    xAxis,
    yAxis,
    // The cursor line follows the pointer across the plot and the strips; the
    // values row and the card's own tooltip read the time from it.
    axisPointer: { triggerOn: 'mousemove|click', animation: false, link: [{ xAxisIndex: 'all' }] },
    series,
  };
}

/** Where each bar goes: side by side within its period, or stacked when `stacked` is set. */
/**
 * Bars side by side in each period, or piled up where `stacked` is true. With
 * a list, rows marked true pile up in one slot and the others (ratios, which
 * cannot be added up) stand beside it.
 */
export function placeBars(
  rows: { t: number[]; end: number[]; v: number[] }[],
  stacked: boolean | boolean[],
): BarShape[][] {
  const out: BarShape[][] = rows.map(() => []);
  const piles = rows.map((_, k) => (Array.isArray(stacked) ? Boolean(stacked[k]) : stacked));
  const anyPile = piles.some(Boolean);
  // The pile takes the first slot; every other row gets one of its own.
  const slots: number[] = [];
  let next = anyPile ? 1 : 0;
  piles.forEach((pile) => slots.push(pile ? 0 : next++));
  const count = Math.max(1, next);
  const up = new Map<number, number>();
  const down = new Map<number, number>();
  rows.forEach((row, k) => {
    row.t.forEach((start, i) => {
      const value = row.v[i];
      if (!Number.isFinite(value) || (piles[k] && value === 0)) return;
      const end = row.end[i];
      const room = (end - start) * 0.1;
      const width = (end - start - 2 * room) / count;
      const from = start + room + slots[k] * width;
      if (piles[k]) {
        const pile = value > 0 ? up : down;
        const base = pile.get(start) ?? 0;
        pile.set(start, base + value);
        out[k].push({ start: from, end: from + width, low: base, high: base + value });
      } else {
        out[k].push({ start: from, end: from + width, low: Math.min(0, value), high: Math.max(0, value) });
      }
    });
  });
  return out;
}

function barSeries(bar: PlotBar, input: PlotInput): Record<string, unknown> {
  const opacity = bar.faded ? input.fadedOpacity : 1;
  return {
    type: 'custom',
    id: bar.key,
    yAxisIndex: bar.axisIndex,
    data: bar.bars.map((b) => [b.start, b.end, b.low, b.high]),
    encode: { x: [0, 1], y: [2, 3] },
    clip: true,
    silent: true,
    z: bar.faded ? 1 : 2,
    animation: input.animation,
    renderItem: (_params: unknown, api: CustomApi) => {
      const topLeft = api.coord([api.value(0), api.value(3)]);
      const bottomRight = api.coord([api.value(1), api.value(2)]);
      const width = Math.max(1, bottomRight[0] - topLeft[0] - 1);
      const height = bottomRight[1] - topLeft[1];
      return {
        type: 'rect',
        shape: { x: topLeft[0], y: topLeft[1], width, height, r: width > 6 ? [2, 2, 0, 0] : 0 },
        style: { fill: bar.color, opacity },
      };
    },
  };
}

function bandSeries(band: PlotBand, axisIndex: number, input: PlotInput): Record<string, unknown> {
  const fill = withAlpha(band.color, band.faded ? 0.14 * input.fadedOpacity : 0.14);
  return {
    type: 'custom',
    id: band.key,
    yAxisIndex: axisIndex,
    data: band.spans.map((span) => [span.start, span.end]),
    encode: { x: [0, 1] },
    clip: true,
    silent: true,
    z: 0,
    animation: false,
    renderItem: (params: CustomParams, api: CustomApi) => {
      const box = params.coordSys;
      const x0 = api.coord([api.value(0), 0])[0];
      const x1 = api.coord([api.value(1), 0])[0];
      return { type: 'rect', shape: { x: x0, y: box.y, width: Math.max(1, x1 - x0), height: box.height }, style: { fill } };
    },
  };
}

/** The track behind each strip, and the entity names above them. */
function timelineFrame(
  strips: TimelineSettings,
  gridIndex: number,
  axisIndex: number,
  input: PlotInput,
): Record<string, unknown> {
  const { theme } = input;
  const nameRoom = strips.names ? NAME_SIZE + 4 : 0;
  return {
    type: 'custom',
    id: '__strips',
    xAxisIndex: gridIndex,
    yAxisIndex: axisIndex,
    data: strips.rows.map((_, r) => [input.axisStart, input.axisEnd, r]),
    encode: { x: [0, 1] },
    silent: true,
    animation: false,
    z: 0,
    renderItem: (params: CustomParams, api: CustomApi) => {
      const box = params.coordSys;
      const r = api.value(2);
      const row = strips.rows[r];
      const block = box.height / strips.rows.length;
      const top = box.y + r * block;
      const height = Math.max(2, block - ROW_GAP - nameRoom);
      const children: Record<string, unknown>[] = [
        {
          type: 'rect',
          shape: { x: box.x, y: top + nameRoom, width: box.width, height, r: 3 },
          style: { fill: theme.divider, opacity: row.faded ? input.fadedOpacity : 0.6 },
        },
      ];
      if (strips.names) {
        children.push({
          type: 'text',
          x: box.x,
          y: top + nameRoom / 2,
          style: {
            text: row.name,
            fill: theme.secondaryText,
            font: `${NAME_SIZE}px ${theme.fontFamily}`,
            verticalAlign: 'middle',
            opacity: row.faded ? 0.5 : 1,
            width: box.width,
            overflow: 'truncate',
          },
        });
      }
      return { type: 'group', children };
    },
  };
}

function timelineSeries(
  row: PlotTimelineRow,
  r: number,
  strips: TimelineSettings,
  gridIndex: number,
  axisIndex: number,
  input: PlotInput,
): Record<string, unknown> {
  const { theme } = input;
  const nameRoom = strips.names ? NAME_SIZE + 4 : 0;
  const opacity = row.faded ? input.fadedOpacity : 1;
  const labelSize = Math.min(12, Math.max(9, strips.rowHeight - 8));
  return {
    type: 'custom',
    id: row.key,
    xAxisIndex: gridIndex,
    yAxisIndex: axisIndex,
    data: row.segments.map((segment, i) => [segment.start, segment.end, i]),
    encode: { x: [0, 1] },
    clip: true,
    silent: true,
    animation: false,
    z: 2,
    renderItem: (params: CustomParams, api: CustomApi) => {
      const box = params.coordSys;
      const segment = row.segments[api.value(2)];
      const block = box.height / strips.rows.length;
      const top = box.y + r * block + nameRoom;
      const height = Math.max(2, block - ROW_GAP - nameRoom);
      const x0 = Math.max(box.x, api.coord([api.value(0), 0])[0]);
      const x1 = Math.min(box.x + box.width, api.coord([api.value(1), 0])[0]);
      if (x1 - x0 < 0.5) return null;
      const fill = segment.color ?? stripes(theme.secondaryText);
      const children: Record<string, unknown>[] = [
        { type: 'rect', shape: { x: x0, y: top, width: x1 - x0, height }, style: { fill, opacity } },
      ];
      if (segment.color && strips.labels && x1 - x0 > 44 && height >= 12) {
        children.push({
          type: 'text',
          x: x0 + 4,
          y: top + height / 2,
          style: {
            text: segment.label,
            fill: readableOn(segment.color, theme),
            font: `${labelSize}px ${theme.fontFamily}`,
            verticalAlign: 'middle',
            width: x1 - x0 - 8,
            overflow: 'truncate',
            opacity,
          },
        });
      }
      return { type: 'group', children };
    },
  };
}

const stripeCache = new Map<string, unknown>();

/**
 * Diagonal stripes for stretches with no state (unavailable or unknown), so
 * they cannot be mistaken for a grey state such as standby.
 */
export function stripes(color: string): unknown {
  let pattern = stripeCache.get(color);
  if (pattern) return pattern;
  const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return 'transparent';
  canvas.width = 6;
  canvas.height = 6;
  ctx.strokeStyle = withAlpha(color, 0.55);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  // One stripe across the tile and its two ends at the corners, so tiles join up.
  for (const [x0, y0, x1, y1] of [[0, 6, 6, 0], [-1, 1, 1, -1], [5, 7, 7, 5]]) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  pattern = { image: canvas, repeat: 'repeat' };
  stripeCache.set(color, pattern);
  return pattern;
}

/** Dark or light text, whichever reads better on `color`. */
function readableOn(color: string, theme: Theme): string {
  if (color.startsWith('rgba')) return theme.text;
  const rgb = toRgb(color);
  if (!rgb) return theme.text;
  const [r, g, b] = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1a1a1a' : '#ffffff';
}

interface CustomParams {
  dataIndex: number;
  coordSys: { x: number; y: number; width: number; height: number };
}

interface CustomApi {
  value(dimension: number): number;
  coord(point: [number, number]): number[];
}

/**
 * The shaded range between a line and another value, drawn as one polygon per
 * unbroken run so neighbouring slots show no seams. Its data carries both
 * values, so the scale makes room for them.
 */
function rangeSeries(s: PlotSeries, input: PlotInput): Record<string, unknown> {
  const band = s.band as NonNullable<PlotSeries['band']>;
  const { t } = s.data;
  const fill = withAlpha(s.color, s.faded ? band.opacity * input.fadedOpacity : band.opacity);
  const step = s.curve === 'step';
  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (Number.isFinite(band.low[i]) && Number.isFinite(band.high[i])) run.push(i);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return {
    type: 'custom',
    id: `${s.key}:range`,
    yAxisIndex: s.axisIndex,
    data: t.map((time, i) => [time, band.low[i], band.high[i]]),
    encode: { x: 0, y: [1, 2] },
    clip: true,
    silent: true,
    z: s.faded ? 0 : 1,
    animation: false,
    renderItem: (params: CustomParams, api: CustomApi) => {
      if (params.dataIndex !== 0) return null;
      const edge = (indices: number[], values: number[]) => {
        const points: number[][] = [];
        indices.forEach((i, k) => {
          points.push(api.coord([t[i], values[i]]));
          // A step holds each value until the next point, as the line does.
          if (step && k < indices.length - 1) points.push(api.coord([t[indices[k + 1]], values[i]]));
        });
        return points;
      };
      return {
        type: 'group',
        children: runs.map((indices) => ({
          type: 'polygon',
          shape: { points: [...edge(indices, band.high), ...edge(indices, band.low).reverse()] },
          style: { fill },
        })),
      };
    },
  };
}

function lineSeries(s: PlotSeries, input: PlotInput): Record<string, unknown> {
  const opacity = s.faded ? input.fadedOpacity : 1;
  const data = new Array<[number, number | null]>(s.data.t.length);
  for (let i = 0; i < data.length; i++) {
    const value = s.data.v[i];
    data[i] = [s.data.t[i], Number.isNaN(value) ? null : value];
  }
  return {
    type: 'line',
    id: s.key,
    name: s.name,
    yAxisIndex: s.axisIndex,
    data,
    showSymbol: false,
    symbol: 'none',
    smooth: s.curve === 'smooth' ? 0.3 : false,
    smoothMonotone: 'x',
    // A Home Assistant value holds until the next change, so the step comes at the end.
    step: s.curve === 'step' ? 'end' : false,
    connectNulls: false,
    stack: s.stack,
    silent: true,
    z: s.faded ? 1 : 2,
    animation: input.animation,
    lineStyle: {
      color: s.color,
      width: s.lineStyle === 'none' ? 0 : s.width,
      opacity: s.lineStyle === 'none' ? 0 : opacity,
      type: s.lineStyle === 'dashed' ? [6, 4] : s.lineStyle === 'dotted' ? [1, 4] : 'solid',
      cap: 'round',
      join: 'round',
    },
    itemStyle: { color: s.color, opacity },
    areaStyle: s.stack
      ? { opacity: opacity * 0.45, color: s.color }
      : s.fill && s.fillOpacity !== undefined
      ? { opacity, color: withAlpha(s.color, s.fillOpacity) }
      : s.fill
      ? {
          opacity,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(s.color, 0.28) },
              { offset: 1, color: withAlpha(s.color, 0) },
            ],
          },
        }
      : undefined,
    emphasis: { disabled: true },
  };
}

function nowLine(now: number, xAxisIndex: number, axisIndex: number, theme: Theme): Record<string, unknown> {
  return {
    type: 'line',
    id: NOW_LINE_ID,
    xAxisIndex,
    yAxisIndex: axisIndex,
    data: [
      [now, 0],
      [now, 1],
    ],
    silent: true,
    animation: false,
    showSymbol: false,
    symbol: 'none',
    z: 0,
    lineStyle: { color: theme.secondaryText, width: 1, type: [3, 3], opacity: 0.7 },
    emphasis: { disabled: true },
  };
}

/** Axis ranges from the bright (not faded) lines only, rounded to tidy steps. */
function brightExtents(input: PlotInput): ({ min: number; max: number } | undefined)[] {
  const { start, end } = input.window;
  return input.axes.map((_, axisIndex) => {
    let low = Infinity;
    let high = -Infinity;
    for (const s of input.series) {
      if (s.axisIndex !== axisIndex || s.faded) continue;
      for (let i = 0; i < s.data.t.length; i++) {
        const t = s.data.t[i];
        if (t < start || t > end) continue;
        for (const value of [s.data.v[i], s.band?.low[i] ?? NaN, s.band?.high[i] ?? NaN]) {
          if (Number.isNaN(value)) continue;
          if (value < low) low = value;
          if (value > high) high = value;
        }
      }
    }
    if (!Number.isFinite(low)) return undefined;
    if (low === high) {
      low -= 1;
      high += 1;
    }
    const range = high - low;
    return { min: low - range * input.yPadding.bottom, max: high + range * input.yPadding.top };
  });
}

type Extent = { min: number; max: number };

/**
 * Scale edges that leave a share of the value range empty above the highest
 * and below the lowest value; at 0 the scale ends exactly at the value. With
 * "include zero", a scale of positive values still starts at 0.
 */
export function paddedBounds(
  pad: { top: number; bottom: number },
  zero: boolean,
): { min: (e: Extent) => number; max: (e: Extent) => number } {
  const span = (e: Extent) => e.max - e.min || Math.abs(e.max) || 1;
  // A flat line at zero, such as solar power at night, gets a scale from 0 to 1, not a sliver around zero.
  const flatZero = (e: Extent) => e.max === 0 && e.min === 0;
  return {
    max: (e) => (flatZero(e) ? 1 : zero && e.max <= 0 ? 0 : e.max + span(e) * pad.top),
    min: (e) => (flatZero(e) ? 0 : zero && e.min >= 0 ? 0 : e.min - span(e) * pad.bottom),
  };
}
