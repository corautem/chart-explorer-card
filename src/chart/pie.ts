import type { Theme } from './theme';

export interface PieSlice {
  name: string;
  value: number;
  color: string;
}

export interface PlotPie {
  key: string;
  /** Slices labelled with their names (states) or with their share only (entities, named in the values row). */
  named: boolean;
  slices: PieSlice[];
}

export interface PieInput {
  pies: PlotPie[];
  donut: boolean;
  theme: Theme;
  animation: boolean;
  hover: boolean;
  width: number;
  height: number;
}

/** Centre of pie `i` of `count`, as a share of the chart width. */
export const pieCentre = (i: number, count: number) => (i + 0.5) / count;

/** Pies side by side: one for the entities' totals, one per entity with states. */
export function buildPieOption(input: PieInput): Record<string, unknown> {
  const { theme } = input;
  const count = Math.max(1, input.pies.length);
  // Room for the labels outside each pie, and for the names above them.
  const named = input.pies.length > 1;
  const radius = Math.max(20, Math.min(input.width / (2 * count), input.height / 2 - (named ? 10 : 0)) * 0.6);
  return {
    animation: input.animation,
    animationDuration: 300,
    animationDurationUpdate: 300,
    textStyle: { fontFamily: theme.fontFamily },
    series: input.pies.map((pie, i) => ({
      type: 'pie',
      id: pie.key,
      center: [`${pieCentre(i, count) * 100}%`, named ? '54%' : '50%'],
      percentPrecision: 0,
      radius: input.donut ? [radius * 0.58, radius] : [0, radius],
      startAngle: 90,
      clockwise: true,
      silent: !input.hover,
      emphasis: input.hover ? { scale: true, scaleSize: 4 } : { disabled: true },
      itemStyle: { borderColor: theme.background, borderWidth: 1 },
      label: {
        show: true,
        position: 'outside',
        formatter: pie.named ? '{b}\n{d}%' : '{d}%',
        color: theme.secondaryText,
        fontSize: 11,
        fontFamily: theme.fontFamily,
        lineHeight: 14,
      },
      labelLine: { show: true, length: 6, length2: 6, lineStyle: { color: theme.divider } },
      data: pie.slices.map((slice) => ({ name: slice.name, value: slice.value, itemStyle: { color: slice.color } })),
    })),
  };
}
