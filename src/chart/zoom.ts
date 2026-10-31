import type { EChartsType } from './echarts';
import type { TimeWindow } from '../time/range';

export interface ZoomHost {
  chart(): EChartsType | undefined;
  window(): TimeWindow | undefined;
  enabled(): boolean;
  zoomTo(start: number, end: number): void;
  zoomBack(): void;
}

const MIN_DRAG_PX = 8;
const MIN_ZOOM_MS = 60_000;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

/**
 * Drag across the chart to zoom into that part; double-click or double-tap to
 * go back. On touch screens only horizontal drags zoom, so the page still scrolls.
 */
export class ZoomController {
  private pointerId?: number;
  private startX = 0;
  private startY = 0;
  private dragging = false;
  private lastTap?: { time: number; x: number; y: number };
  private lastTouchZoomBack = 0;

  constructor(
    private readonly surface: HTMLElement,
    private readonly selection: HTMLElement,
    private readonly host: ZoomHost,
  ) {
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onCancel);
    surface.addEventListener('dblclick', this.onDoubleClick);
  }

  destroy(): void {
    this.surface.removeEventListener('pointerdown', this.onDown);
    this.surface.removeEventListener('pointermove', this.onMove);
    this.surface.removeEventListener('pointerup', this.onUp);
    this.surface.removeEventListener('pointercancel', this.onCancel);
    this.surface.removeEventListener('dblclick', this.onDoubleClick);
  }

  private position(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private plotBounds(): { left: number; right: number } | undefined {
    const chart = this.host.chart();
    const window = this.host.window();
    if (!chart || !window) return undefined;
    const left = Number(chart.convertToPixel({ xAxisIndex: 0 }, window.start));
    const right = Number(chart.convertToPixel({ xAxisIndex: 0 }, window.end));
    return Number.isFinite(left) && Number.isFinite(right) ? { left, right } : undefined;
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.host.enabled() || event.button !== 0 || this.pointerId !== undefined) return;
    const bounds = this.plotBounds();
    const { x, y } = this.position(event);
    if (!bounds || x < bounds.left || x > bounds.right) return;
    this.pointerId = event.pointerId;
    this.startX = x;
    this.startY = y;
    this.dragging = false;
  };

  private onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const { x, y } = this.position(event);
    const dx = x - this.startX;
    if (!this.dragging) {
      if (Math.abs(dx) < MIN_DRAG_PX) return;
      if (event.pointerType === 'touch' && Math.abs(y - this.startY) > Math.abs(dx)) {
        this.reset();
        return;
      }
      this.dragging = true;
      this.surface.setPointerCapture(event.pointerId);
      this.selection.style.display = 'block';
    }
    const bounds = this.plotBounds();
    if (!bounds) return;
    const clamped = Math.min(bounds.right, Math.max(bounds.left, x));
    this.selection.style.left = `${Math.min(this.startX, clamped)}px`;
    this.selection.style.width = `${Math.abs(clamped - this.startX)}px`;
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const { x, y } = this.position(event);
    if (this.dragging) {
      const chart = this.host.chart();
      const bounds = this.plotBounds();
      if (chart && bounds) {
        const clamped = Math.min(bounds.right, Math.max(bounds.left, x));
        const a = Number(chart.convertFromPixel({ xAxisIndex: 0 }, Math.min(this.startX, clamped)));
        const b = Number(chart.convertFromPixel({ xAxisIndex: 0 }, Math.max(this.startX, clamped)));
        if (Number.isFinite(a) && Number.isFinite(b) && b - a >= MIN_ZOOM_MS) {
          this.host.zoomTo(Math.round(a), Math.round(b));
        }
      }
    } else if (event.pointerType === 'touch') {
      const last = this.lastTap;
      if (
        last &&
        event.timeStamp - last.time < DOUBLE_TAP_MS &&
        Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_PX
      ) {
        this.lastTap = undefined;
        this.lastTouchZoomBack = event.timeStamp;
        this.host.zoomBack();
      } else {
        this.lastTap = { time: event.timeStamp, x, y };
      }
    }
    this.reset();
  };

  private onCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.reset();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    // Some mobile browsers also send dblclick after a double tap already handled.
    if (event.timeStamp - this.lastTouchZoomBack < 600) return;
    if (this.host.enabled()) this.host.zoomBack();
  };

  private reset(): void {
    if (this.pointerId !== undefined && this.surface.hasPointerCapture?.(this.pointerId)) {
      this.surface.releasePointerCapture(this.pointerId);
    }
    this.pointerId = undefined;
    this.dragging = false;
    this.selection.style.display = 'none';
  }
}
