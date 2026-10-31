import { describe, expect, it } from 'vitest';
import { paddedBounds } from '../src/chart/timeseries';
import { shiftWindow, zoomWindow } from '../src/chart/interaction';

describe('space above and below the values', () => {
  const extent = { min: 20, max: 40 };

  it('leaves a share of the value range empty', () => {
    const bounds = paddedBounds({ top: 0.1, bottom: 0.25 }, false);
    expect(bounds.max(extent)).toBe(42);
    expect(bounds.min(extent)).toBe(15);
  });

  it('at 0 the scale ends exactly at the values', () => {
    const bounds = paddedBounds({ top: 0, bottom: 0 }, false);
    expect(bounds.max(extent)).toBe(40);
    expect(bounds.min(extent)).toBe(20);
  });

  it('with "include zero", positive values still start at 0', () => {
    const bounds = paddedBounds({ top: 0.1, bottom: 0.1 }, true);
    expect(bounds.min(extent)).toBe(0);
    expect(bounds.max({ min: -30, max: -10 })).toBe(0);
  });

  it('copes with a flat line', () => {
    const bounds = paddedBounds({ top: 0.1, bottom: 0.1 }, false);
    expect(bounds.max({ min: 5, max: 5 })).toBe(5.5);
  });
});

describe('gestures', () => {
  const day = { start: 0, end: 24 * 3_600_000 };

  it('dragging moves the window by a length of time', () => {
    expect(shiftWindow(day, -3_600_000)).toEqual({ start: -3_600_000, end: 23 * 3_600_000 });
  });

  it('zooming keeps the time under the fingers in place', () => {
    const anchor = 18 * 3_600_000;
    const zoomed = zoomWindow(day, 0.5, anchor);
    expect(zoomed.end - zoomed.start).toBe(12 * 3_600_000);
    expect((anchor - zoomed.start) / (zoomed.end - zoomed.start)).toBeCloseTo(0.75);
  });

  it('zooming stops at one minute and at twenty years', () => {
    const tiny = zoomWindow(day, 1e-9, 0);
    expect(tiny.end - tiny.start).toBe(60_000);
    const huge = zoomWindow(day, 1e9, 0);
    expect(huge.end - huge.start).toBe(20 * 366 * 86_400_000);
  });
});
