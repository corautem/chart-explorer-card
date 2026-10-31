import type { CardConfig } from '../config';
import { toHex, toRgb, type Theme } from './theme';
import { stripes } from './timeseries';

export interface HeatCell {
  /** Start and end of the local day, and the hour of day (0 to 23). */
  day: number;
  dayEnd: number;
  hour: number;
  value: number;
  /** For an entity with states: the state that held longest, and its colour (none for striped). */
  state?: string;
  color?: string;
}

export interface HeatmapInput {
  cells: HeatCell[];
  color: string;
  theme: Theme;
  axisStart: number;
  axisEnd: number;
  splitNumber: number;
  xAxis: CardConfig['xAxis'];
  yAxis: CardConfig['yAxis'];
  animation: boolean;
  axisTime(ms: number): string;
  cursorTime(ms: number): string;
  hourLabel(hour: number): string;
}

/** A colour between the card background (lowest) and the entity colour (highest), `share` from 0 to 1. */
export function heatColor(share: number, color: string, background: string): string {
  const high = toRgb(color) ?? [42, 120, 214];
  const low = toRgb(background) ?? [255, 255, 255];
  const k = 0.1 + 0.9 * Math.min(1, Math.max(0, share));
  return toHex(low.map((c, i) => c + (high[i] - c) * k));
}

export function valueRange(cells: HeatCell[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const cell of cells) {
    if (cell.state !== undefined) continue;
    if (cell.value < min) min = cell.value;
    if (cell.value > max) max = cell.value;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** Days across, hours of the day down, each hour coloured by its value or by the state that held longest. */
export function buildHeatmapOption(input: HeatmapInput): Record<string, unknown> {
  const { theme } = input;
  const font = (size: number) => ({ color: theme.secondaryText, fontSize: size, fontFamily: theme.fontFamily });
  const { min, max } = valueRange(input.cells);
  const span = max - min || 1;
  const pointerLabel = {
    color: theme.background,
    backgroundColor: theme.secondaryText,
    fontSize: 11,
    fontFamily: theme.fontFamily,
    padding: [2, 6],
    borderRadius: 4,
  };
  return {
    animation: input.animation,
    textStyle: { fontFamily: theme.fontFamily },
    grid: { left: 4, right: 4, top: 10, bottom: 4 },
    xAxis: {
      type: 'time',
      min: input.axisStart,
      max: input.axisEnd,
      splitNumber: input.splitNumber,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...font(input.xAxis.labelSize),
        show: input.xAxis.show,
        hideOverlap: true,
        formatter: (value: number) => input.axisTime(value),
      },
      splitLine: { show: false },
      axisPointer: {
        show: true,
        snap: false,
        type: 'line',
        triggerTooltip: false,
        lineStyle: { color: theme.secondaryText, width: 1 },
        label: { ...pointerLabel, formatter: (p: { value: number | string }) => input.cursorTime(Number(p.value)) },
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 24,
      interval: 6,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...font(input.yAxis.labelSize),
        show: input.yAxis.show,
        showMaxLabel: false,
        formatter: (hour: number) => input.hourLabel(hour),
      },
      splitLine: { show: false },
      axisPointer: {
        show: true,
        snap: false,
        type: 'none',
        triggerTooltip: false,
        label: { ...pointerLabel, formatter: (p: { value: number | string }) => input.hourLabel(Math.floor(Number(p.value))) },
      },
    },
    axisPointer: { triggerOn: 'mousemove|click', animation: false },
    series: [
      {
        type: 'custom',
        id: '__heatmap',
        data: input.cells.map((cell) => [cell.day, cell.dayEnd, cell.hour, cell.hour + 1, cell.value]),
        encode: { x: [0, 1], y: [2, 3] },
        clip: true,
        silent: true,
        animation: false,
        renderItem: (
          params: { dataIndex: number },
          api: { value(d: number): number; coord(p: [number, number]): number[] },
        ) => {
          const cell = input.cells[params.dataIndex];
          const a = api.coord([api.value(0), api.value(2)]);
          const b = api.coord([api.value(1), api.value(3)]);
          const width = b[0] - a[0];
          const height = b[1] - a[1];
          // A hairline between cells once they are big enough to show it.
          const gap = width > 4 ? 1 : 0;
          return {
            type: 'rect',
            shape: { x: a[0], y: a[1], width: Math.max(0.5, width - gap), height: Math.max(0.5, height - (height > 4 ? 1 : 0)) },
            style: {
              fill:
                cell?.state !== undefined
                  ? (cell.color ?? stripes(theme.secondaryText))
                  : heatColor((api.value(4) - min) / span, input.color, theme.background),
            },
          };
        },
      },
    ],
  };
}
