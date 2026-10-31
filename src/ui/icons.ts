import { svg } from 'lit';

// Material Design Icons paths (Apache-2.0), inlined so the card does not
// depend on Home Assistant's icon elements.
const PATHS = {
  chevronLeft: 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z',
  chevronRight: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
  download: 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z',
  menuDown: 'M7,10L12,15L17,10H7Z',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName) {
  return svg`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=${PATHS[name]}></path></svg>`;
}
