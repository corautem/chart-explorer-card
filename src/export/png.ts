import type { EChartsType } from '../chart/echarts';
import type { Theme } from '../chart/theme';

export interface PngLegendItem {
  name: string;
  /** Empty for a striped key. */
  color: string;
  faded: boolean;
  /** A square key, as for the states of a heatmap, instead of a line. */
  square?: boolean;
}

export interface PngOptions {
  title?: string;
  range: string;
  legend: PngLegendItem[];
  theme: Theme;
  fadedOpacity: number;
  /** Units above the scales, placed by the card in chart pixels. */
  units?: { text: string; x: number }[];
  unitSize?: number;
  /** A heatmap's colour key, drawn at the right of the range line. */
  scale?: { min: string; max: string; from: string; to: string };
}

const SCALE = 2;

/** The chart at double pixel density, with title, range and coloured entity names above it. */
export async function chartPng(chart: EChartsType, options: PngOptions): Promise<Blob> {
  const { theme } = options;
  const image = await loadImage(
    chart.getDataURL({ type: 'png', pixelRatio: SCALE, backgroundColor: theme.background }),
  );
  const width = image.width;
  const pad = 12 * SCALE;
  const font = (size: number, weight = 400) => `${weight} ${size * SCALE}px ${theme.fontFamily}`;

  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  measure.font = font(12);
  const key = 14 * SCALE;
  const gap = 6 * SCALE;
  const itemGap = 16 * SCALE;
  const rowHeight = 18 * SCALE;
  const placed: { item: PngLegendItem; x: number; row: number }[] = [];
  let x = pad;
  let row = 0;
  for (const item of options.legend) {
    const itemWidth = key + gap + measure.measureText(item.name).width;
    if (x > pad && x + itemWidth > width - pad) {
      x = pad;
      row++;
    }
    placed.push({ item, x, row });
    x += itemWidth + itemGap;
  }

  const titleHeight = options.title ? 22 * SCALE : 0;
  const rangeHeight = 18 * SCALE;
  const legendHeight = placed.length ? (row + 1) * rowHeight : 0;
  const headerHeight = pad + titleHeight + rangeHeight + legendHeight + 4 * SCALE;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = headerHeight + image.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';

  let y = pad;
  if (options.title) {
    ctx.fillStyle = theme.text;
    ctx.font = font(16, 600);
    ctx.fillText(options.title, pad, y + titleHeight / 2);
    y += titleHeight;
  }
  ctx.fillStyle = theme.secondaryText;
  ctx.font = font(12);
  ctx.fillText(options.range, pad, y + rangeHeight / 2);
  if (options.scale) {
    const { min, max, from, to } = options.scale;
    const bar = 60 * SCALE;
    const maxWidth = ctx.measureText(max).width;
    const barRight = width - pad - maxWidth - gap;
    const gradient = ctx.createLinearGradient(barRight - bar, 0, barRight, 0);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(barRight - bar, y + rangeHeight / 2 - 4 * SCALE, bar, 8 * SCALE);
    ctx.fillStyle = theme.secondaryText;
    ctx.textAlign = 'right';
    ctx.fillText(min, barRight - bar - gap, y + rangeHeight / 2);
    ctx.textAlign = 'left';
    ctx.fillText(max, barRight + gap, y + rangeHeight / 2);
  }
  y += rangeHeight;

  for (const { item, x: itemX, row: itemRow } of placed) {
    const cy = y + itemRow * rowHeight + rowHeight / 2;
    ctx.globalAlpha = item.faded ? options.fadedOpacity : 1;
    if (item.square) drawSquare(ctx, itemX + 2 * SCALE, cy - 5 * SCALE, 10 * SCALE, item.color, theme.secondaryText);
    else {
      ctx.fillStyle = item.color;
      ctx.fillRect(itemX, cy - SCALE, key, 2 * SCALE);
    }
    ctx.globalAlpha = item.faded ? 0.5 : 1;
    ctx.fillStyle = theme.text;
    ctx.fillText(item.name, itemX + key + gap, cy);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(image, 0, headerHeight);
  if (options.units?.length) {
    const size = options.unitSize ?? 11;
    ctx.font = font(size);
    ctx.fillStyle = theme.secondaryText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const unit of options.units) ctx.fillText(unit.text, unit.x * SCALE, headerHeight + 4 * SCALE);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png'),
  );
}

/** A filled square, or diagonal stripes when there is no colour. */
function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, stripe: string): void {
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.strokeStyle = stripe;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = 1.2 * SCALE;
  ctx.beginPath();
  for (let d = -size; d < size; d += 4 * SCALE) {
    ctx.moveTo(x + d, y + size);
    ctx.lineTo(x + d + size, y);
  }
  ctx.stroke();
  ctx.restore();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('PNG export failed'));
    image.src = url;
  });
}
