import type { DragAction } from '../config';
import type { TimeWindow } from '../time/range';
import type { EChartsType } from './echarts';

export interface InteractionHost {
  chart(): EChartsType | undefined;
  /** The drawn time axis: the window plus any space at its sides. */
  axis(): TimeWindow | undefined;
  /** The window being shown, including one previewed during a gesture. */
  window(): TimeWindow | undefined;
  enabled(): boolean;
  dragAction(): DragAction;
  /** Moves the drawn window during a gesture, without loading data. */
  preview(window: TimeWindow): void;
  /** Applies a window when a gesture ends; data loads for it. */
  commit(window: TimeWindow): void;
  /** Double-click or double-tap: back to the window picked before the gestures. */
  back(): void;
}

const MIN_LENGTH = 60_000;
const MAX_LENGTH = 20 * 366 * 86_400_000;
const MIN_DRAG_PX = 6;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
const WHEEL_SETTLE_MS = 350;

/** The window moved by a length of time (positive is later). */
export function shiftWindow(window: TimeWindow, by: number): TimeWindow {
  return { start: Math.round(window.start + by), end: Math.round(window.end + by) };
}

/**
 * The window scaled by `factor` (below 1 zooms in) around `anchor`, a time that
 * stays under the fingers or the pointer.
 */
export function zoomWindow(window: TimeWindow, factor: number, anchor: number): TimeWindow {
  const length = window.end - window.start;
  const next = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length * factor));
  const ratio = length > 0 ? (anchor - window.start) / length : 0.5;
  const start = anchor - ratio * next;
  return { start: Math.round(start), end: Math.round(start + next) };
}

type Gesture =
  | { kind: 'pan' | 'select'; pointerId: number; startX: number; startY: number; start: TimeWindow; moved: boolean; current?: TimeWindow }
  | { kind: 'pinch'; distance: number; anchor: number; start: TimeWindow; current?: TimeWindow }
  | { kind: 'done' };

/**
 * Gestures on the chart. Drag moves the window (or, with drag_action: zoom or
 * Shift held, selects a part to zoom into); pinch and Ctrl + wheel zoom; a
 * double-click or double-tap goes back. On touch screens a vertical swipe still
 * scrolls the page.
 */
export class InteractionController {
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture?: Gesture;
  private lastTap?: { time: number; x: number; y: number };
  private lastTouchBack = 0;
  private wheelWindow?: TimeWindow;
  private wheelTimer?: number;

  constructor(
    private readonly surface: HTMLElement,
    private readonly selection: HTMLElement,
    private readonly host: InteractionHost,
  ) {
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onCancel);
    surface.addEventListener('dblclick', this.onDoubleClick);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
  }

  destroy(): void {
    this.surface.removeEventListener('pointerdown', this.onDown);
    this.surface.removeEventListener('pointermove', this.onMove);
    this.surface.removeEventListener('pointerup', this.onUp);
    this.surface.removeEventListener('pointercancel', this.onCancel);
    this.surface.removeEventListener('dblclick', this.onDoubleClick);
    this.surface.removeEventListener('wheel', this.onWheel);
    clearTimeout(this.wheelTimer);
  }

  private position(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Left and right edge of the plot in pixels, and the axis they stand for. */
  private plot(): { left: number; right: number; axis: TimeWindow } | undefined {
    const chart = this.host.chart();
    const axis = this.host.axis();
    if (!chart || !axis) return undefined;
    const left = Number(chart.convertToPixel({ xAxisIndex: 0 }, axis.start));
    const right = Number(chart.convertToPixel({ xAxisIndex: 0 }, axis.end));
    return Number.isFinite(left) && Number.isFinite(right) && right > left ? { left, right, axis } : undefined;
  }

  private timeAt(x: number): number | undefined {
    const plot = this.plot();
    if (!plot) return undefined;
    const ratio = (x - plot.left) / (plot.right - plot.left);
    return plot.axis.start + ratio * (plot.axis.end - plot.axis.start);
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.host.enabled() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const { x, y } = this.position(event);
    const plot = this.plot();
    if (!plot || x < plot.left || x > plot.right) return;
    this.pointers.set(event.pointerId, { x, y, type: event.pointerType });
    const window = this.host.window();
    if (!window) return;

    if (this.pointers.size === 2 && event.pointerType === 'touch') {
      // A second finger turns the gesture into a pinch.
      const [a, b] = [...this.pointers.values()];
      const anchor = this.timeAt((a.x + b.x) / 2);
      if (anchor === undefined) return;
      this.hideSelection();
      const start = this.gesture && 'current' in this.gesture && this.gesture.current ? this.gesture.current : window;
      this.gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor, start };
      for (const id of this.pointers.keys()) this.capture(id);
      return;
    }
    if (this.pointers.size === 1) {
      const select = this.host.dragAction() === 'zoom' || event.shiftKey;
      this.gesture = { kind: select ? 'select' : 'pan', pointerId: event.pointerId, startX: x, startY: y, start: window, moved: false };
    }
  };

  private onMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const { x, y } = this.position(event);
    pointer.x = x;
    pointer.y = y;
    const gesture = this.gesture;
    if (!gesture || gesture.kind === 'done') return;

    if (gesture.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      gesture.current = zoomWindow(gesture.start, gesture.distance / distance, gesture.anchor);
      this.host.preview(gesture.current);
      event.preventDefault();
      return;
    }

    if (event.pointerId !== gesture.pointerId) return;
    const dx = x - gesture.startX;
    if (!gesture.moved) {
      if (Math.abs(dx) < MIN_DRAG_PX) return;
      if (event.pointerType === 'touch' && Math.abs(y - gesture.startY) > Math.abs(dx)) {
        // A vertical swipe scrolls the page.
        this.pointers.delete(event.pointerId);
        this.gesture = undefined;
        return;
      }
      gesture.moved = true;
      this.capture(event.pointerId);
      if (gesture.kind === 'select') this.selection.style.display = 'block';
    }
    const plot = this.plot();
    if (!plot) return;
    if (gesture.kind === 'pan') {
      const msPerPx = (plot.axis.end - plot.axis.start) / (plot.right - plot.left);
      gesture.current = shiftWindow(gesture.start, -dx * msPerPx);
      this.host.preview(gesture.current);
    } else {
      const clamped = Math.min(plot.right, Math.max(plot.left, x));
      this.selection.style.left = `${Math.min(gesture.startX, clamped)}px`;
      this.selection.style.width = `${Math.abs(clamped - gesture.startX)}px`;
    }
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    const { x, y } = this.position(event);
    this.pointers.delete(event.pointerId);
    this.release(event.pointerId);
    const gesture = this.gesture;
    if (!gesture) return;

    if (gesture.kind === 'pinch') {
      if (gesture.current) this.host.commit(gesture.current);
      // Ignore the finger still down until it lifts.
      this.gesture = this.pointers.size ? { kind: 'done' } : undefined;
      return;
    }
    if (gesture.kind === 'done') {
      if (!this.pointers.size) this.gesture = undefined;
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    this.gesture = undefined;

    if (gesture.moved && gesture.kind === 'pan' && gesture.current) {
      this.host.commit(gesture.current);
    } else if (gesture.moved && gesture.kind === 'select') {
      this.hideSelection();
      const a = this.timeAt(Math.min(gesture.startX, x));
      const b = this.timeAt(Math.max(gesture.startX, x));
      if (a !== undefined && b !== undefined && b - a >= MIN_LENGTH) {
        this.host.commit({ start: Math.round(a), end: Math.round(b) });
      }
    } else if (!gesture.moved && event.pointerType === 'touch') {
      const last = this.lastTap;
      if (last && event.timeStamp - last.time < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_PX) {
        this.lastTap = undefined;
        this.lastTouchBack = event.timeStamp;
        this.host.back();
      } else {
        this.lastTap = { time: event.timeStamp, x, y };
      }
    }
  };

  private onCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.release(event.pointerId);
    if (!this.pointers.size) {
      this.gesture = undefined;
      this.hideSelection();
    }
  };

  private onDoubleClick = (event: MouseEvent): void => {
    // Some mobile browsers also send dblclick after a double tap already handled.
    if (event.timeStamp - this.lastTouchBack < 600) return;
    if (this.host.enabled()) this.host.back();
  };

  /** Ctrl + wheel, which is also what a trackpad pinch sends, zooms at the pointer. */
  private onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey || !this.host.enabled()) return;
    const anchor = this.timeAt(this.position(event).x);
    const base = this.wheelWindow ?? this.host.window();
    if (anchor === undefined || !base) return;
    event.preventDefault();
    const window = zoomWindow(base, Math.exp(event.deltaY * 0.0025), anchor);
    this.wheelWindow = window;
    this.host.preview(window);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window === undefined ? undefined : globalThis.setTimeout(() => {
      this.wheelWindow = undefined;
      this.host.commit(window);
    }, WHEEL_SETTLE_MS) as unknown as number;
  };

  private capture(pointerId: number): void {
    try {
      this.surface.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone.
    }
  }

  private release(pointerId: number): void {
    if (this.surface.hasPointerCapture?.(pointerId)) this.surface.releasePointerCapture(pointerId);
  }

  private hideSelection(): void {
    this.selection.style.display = 'none';
  }
}
