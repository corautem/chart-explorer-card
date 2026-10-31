import type { CsvSettings } from '../config';
import { csvTime } from '../time/format';
import { indexAtOrAfter, indexAtOrBefore } from '../data/series';

export interface CsvColumn {
  header: string;
  t: number[];
  v: number[];
  /** State text per point; when present it is written instead of the number. */
  s?: string[];
}

/**
 * One row per timestamp of any column inside [start, end), with a local-time
 * `time` column first. The first row, at `start`, holds the values the lines
 * enter the window with. A cell stays blank when its column has no point at
 * that time, unless `fill` is "previous". UTF-8 with BOM and CRLF, for Excel.
 */
export function buildCsv(columns: CsvColumn[], start: number, end: number, settings: CsvSettings): string {
  const sep = settings.separator;
  const cell = (c: CsvColumn, i: number) => (c.s ? (c.s[i] ?? '') : formatValue(c.v[i], settings.decimal));
  const lines: string[] = [
    ['time', ...columns.map((c) => headerCell(c.header))].map((text) => quote(text, sep)).join(sep),
  ];
  const next = columns.map((c) => indexAtOrAfter(c.t, start));
  // Values carried in from before the window, as of `start`.
  const previous: string[] = columns.map((c) => {
    const i = indexAtOrBefore(c.t, start);
    return i >= 0 && c.t[i] < start ? cell(c, i) : '';
  });
  const startsInside = columns.some((c, k) => c.t[next[k]] === start);
  if (!startsInside && previous.some((text) => text !== '')) {
    lines.push([csvTime(start), ...previous].map((text) => quote(text, sep)).join(sep));
  }

  for (;;) {
    let time = Infinity;
    for (let c = 0; c < columns.length; c++) {
      const i = next[c];
      const t = columns[c].t;
      if (i < t.length && t[i] < end && t[i] < time) time = t[i];
    }
    if (time === Infinity) break;

    const cells = [csvTime(time)];
    for (let c = 0; c < columns.length; c++) {
      const { t } = columns[c];
      let i = next[c];
      if (i < t.length && t[i] === time) {
        while (i + 1 < t.length && t[i + 1] === time) i++;
        previous[c] = cell(columns[c], i);
        next[c] = i + 1;
        cells.push(previous[c]);
      } else {
        cells.push(settings.fill === 'previous' ? previous[c] : '');
      }
    }
    lines.push(cells.map((text) => quote(text, sep)).join(sep));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export interface CsvSlice {
  name: string;
  value: number;
  unit: string;
  /** Share of its pie, 0 to 100. */
  share: number;
}

/** A pie as a table: one row per slice with its value, unit and share. */
export function buildPieCsv(slices: CsvSlice[], settings: CsvSettings): string {
  const sep = settings.separator;
  const lines = [['name', 'value', 'unit', 'percent'].join(sep)];
  for (const slice of slices) {
    lines.push(
      [
        headerCell(slice.name),
        formatValue(slice.value, settings.decimal),
        slice.unit,
        formatValue(Math.round(slice.share * 10) / 10, settings.decimal),
      ]
        .map((text) => quote(text, sep))
        .join(sep),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function formatValue(value: number, decimal: '.' | ','): string {
  if (!Number.isFinite(value)) return '';
  // toPrecision(12) drops floating-point noise such as 0.30000000000000004.
  const text = String(Number(value.toPrecision(12)));
  return decimal === ',' ? text.replace('.', ',') : text;
}

/** Keeps spreadsheet programs from reading a header such as "=x" as a formula. */
function headerCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function quote(cell: string, sep: string): string {
  return cell.includes(sep) || /["\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
