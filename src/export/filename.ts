import { fileStamp, isLocalMidnight } from '../time/format';
import type { TimeWindow } from '../time/range';

/**
 * `<title or "chart">_<start>_<end>.<ext>`. Whole-day windows use dates only,
 * with the last day included as the end; other windows add the time (HHmm).
 */
export function exportFileName(title: string | undefined, window: TimeWindow, ext: 'csv' | 'png'): string {
  const base = sanitize(title ?? '') || 'chart';
  const wholeDays = isLocalMidnight(window.start) && isLocalMidnight(window.end);
  const end = wholeDays ? window.end - 1 : window.end;
  return `${base}_${fileStamp(window.start, !wholeDays)}_${fileStamp(end, !wholeDays)}.${ext}`;
}

function sanitize(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
