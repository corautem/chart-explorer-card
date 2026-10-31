import { describe, expect, it } from 'vitest';
import { buildCsv } from '../src/export/csv';
import type { CsvSettings } from '../src/config';

const local = (h: number, min = 0, s = 0) => new Date(2026, 9, 30, h, min, s).getTime();
const settings: CsvSettings = { separator: ',', decimal: '.', fill: 'blank' };

const flow = { header: 'Flow (°C)', t: [local(8), local(9), local(10)], v: [30.5, 31, 32.25] };
const power = { header: 'Power (W)', t: [local(8, 30), local(10)], v: [1200, NaN] };

const rows = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);

describe('CSV export', () => {
  it('starts with a BOM, uses CRLF and a time column', () => {
    const csv = buildCsv([flow], local(8), local(12), settings);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(rows(csv)).toEqual(['time,Flow (°C)', '2026-10-30 08:00:00,30.5', '2026-10-30 09:00:00,31', '2026-10-30 10:00:00,32.25']);
  });

  it('one row per timestamp of any column, blank where a column has no point', () => {
    expect(rows(buildCsv([flow, power], local(8), local(12), settings))).toEqual([
      'time,Flow (°C),Power (W)',
      '2026-10-30 08:00:00,30.5,',
      '2026-10-30 08:30:00,,1200',
      '2026-10-30 09:00:00,31,',
      '2026-10-30 10:00:00,32.25,',
    ]);
  });

  it('can repeat the last value instead of leaving cells blank', () => {
    const lines = rows(buildCsv([flow, power], local(8), local(12), { ...settings, fill: 'previous' }));
    expect(lines[2]).toBe('2026-10-30 08:30:00,30.5,1200');
    expect(lines[3]).toBe('2026-10-30 09:00:00,31,1200');
  });

  it('starts with the values carried into the window', () => {
    expect(rows(buildCsv([flow, power], local(9, 15), local(12), settings))).toEqual([
      'time,Flow (°C),Power (W)',
      '2026-10-30 09:15:00,31,1200',
      '2026-10-30 10:00:00,32.25,',
    ]);
  });

  it('leaves out points at or after the window end', () => {
    expect(rows(buildCsv([flow], local(8), local(10), settings))).toHaveLength(3);
  });

  it('supports a semicolon separator with decimal commas', () => {
    const lines = rows(buildCsv([flow], local(8), local(12), { separator: ';', decimal: ',', fill: 'blank' }));
    expect(lines[0]).toBe('time;Flow (°C)');
    expect(lines[3]).toBe('2026-10-30 10:00:00;32,25');
  });

  it('quotes fields that contain the separator or quotes', () => {
    const odd = { header: 'Flow, "main" (°C)', t: [local(8)], v: [1.5] };
    expect(rows(buildCsv([odd], local(8), local(9), { ...settings, decimal: ',' }))).toEqual([
      'time,"Flow, ""main"" (°C)"',
      '2026-10-30 08:00:00,"1,5"',
    ]);
  });

  it('stops spreadsheet programs reading a header as a formula', () => {
    const risky = { header: '=cmd()', t: [local(8)], v: [1] };
    expect(rows(buildCsv([risky], local(8), local(9), settings))[0]).toBe("time,'=cmd()");
  });

  it('drops floating-point noise', () => {
    const noisy = { header: 'x', t: [local(8)], v: [0.1 + 0.2] };
    expect(rows(buildCsv([noisy], local(8), local(9), settings))[1]).toBe('2026-10-30 08:00:00,0.3');
  });
});
