export interface Theme {
  dark: boolean;
  text: string;
  secondaryText: string;
  divider: string;
  background: string;
  primary: string;
  fontFamily: string;
}

/** Reads the Home Assistant theme variables the canvas cannot read itself. */
export function readTheme(element: Element, dark: boolean): Theme {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    dark,
    text: read('--primary-text-color', dark ? '#e1e1e1' : '#212121'),
    secondaryText: read('--secondary-text-color', dark ? '#9b9b9b' : '#727272'),
    divider: read('--divider-color', dark ? 'rgba(225, 225, 225, 0.12)' : 'rgba(0, 0, 0, 0.12)'),
    background:
      read('--ha-card-background', '') || read('--card-background-color', dark ? '#1c1c1c' : '#ffffff'),
    primary: read('--primary-color', '#03a9f4'),
    fontFamily: style.fontFamily || 'system-ui, sans-serif',
  };
}

// Default series colours: eight hues in an order chosen so neighbours stay
// apart for colour-blind readers, with separate steps for light and dark themes.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Colour for the n-th entity; from the ninth on, hues repeat with dashed lines. */
export function seriesColor(index: number, dark: boolean): { color: string; dashed: boolean } {
  const list = dark ? DARK : LIGHT;
  return { color: list[index % list.length], dashed: index >= list.length };
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour as [red, green, blue], or undefined when it cannot be read. */
export function toRgb(color: string): [number, number, number] | undefined {
  let hex = color.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    if (probe === undefined) {
      probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    }
    if (!probe) return undefined;
    probe.fillStyle = '#000000';
    probe.fillStyle = color;
    const normalised = String(probe.fillStyle);
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalised);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    hex = normalised;
  }
  if (hex.length === 4) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Any CSS colour with transparency added, for fills. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = toRgb(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

export function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}
