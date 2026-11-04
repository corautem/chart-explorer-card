import '../src/chart-explorer-card';
import type { CardConfigInput } from '../src/config';
import type { HomeAssistant } from '../src/ha-types';
import { addLoadEntities, createHass, tickHass } from './fake-hass';

// Query parameters: theme=dark, width=390, delay=ms, fail=1, only=N, live=seconds, lang=en-US
const params = new URLSearchParams(location.search);
const dark = params.get('theme') === 'dark';
document.body.className = dark ? 'dark' : 'light';
if (params.get('width')) document.body.style.setProperty('--slot-width', `${params.get('width')}px`);

// A minimal ha-card, like Home Assistant's own.
customElements.define(
  'ha-card',
  class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>:host{display:block;background:var(--ha-card-background,var(--card-background-color));
        border:1px solid var(--divider-color);border-radius:12px;color:var(--primary-text-color)}</style><slot></slot>`;
    }
  },
);

const ENTITIES = [
  { entity: 'sensor.demo_flow_temperature', name: 'Flow', fill: true },
  { entity: 'sensor.demo_return_temperature', name: 'Return' },
  { entity: 'sensor.demo_outdoor_temperature', name: 'Outdoor' },
  { entity: 'sensor.demo_heat_pump_power', name: 'Power' },
];

const CONFIGS: CardConfigInput[] = [
  { type: 'custom:chart-explorer-card', title: 'Heating', default_range: '24h', entities: ENTITIES },
  {
    type: 'custom:chart-explorer-card',
    title: 'Toolbar at the bottom',
    toolbar_position: 'bottom',
    default_range: 'this_week',
    entities: ENTITIES.slice(0, 3),
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Tooltip, animation, step lines',
    tooltip: true,
    lightweight: false,
    default_range: '6h',
    entities: [
      { entity: 'sensor.demo_heat_pump_power', name: 'Power', curve: 'step' },
      { entity: 'sensor.demo_no_statistics', name: 'No statistics' },
    ],
  },
];

CONFIGS.push(
  {
    type: 'custom:chart-explorer-card',
    title: 'Heat pump status',
    default_range: '24h',
    entities: [
      { entity: 'sensor.demo_flow_temperature', name: 'Flow' },
      { entity: 'binary_sensor.demo_heating', name: 'Heating', type: 'band' },
      { entity: 'sensor.demo_heat_pump_status', name: 'Status' },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'States only',
    default_range: '12h',
    entities: [
      { entity: 'sensor.demo_heat_pump_status', name: 'Status' },
      { entity: 'binary_sensor.demo_heating', name: 'Heating' },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Energy per day',
    chart_type: 'bar',
    default_range: 'this_week',
    entities: [
      { entity: 'sensor.demo_energy', name: 'Heat pump' },
      { entity: 'sensor.demo_hot_water_energy', name: 'Hot water' },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Power, stacked',
    chart_type: 'area',
    default_range: '6h',
    entities: [
      { entity: 'sensor.demo_house_power', name: 'House' },
      { entity: 'sensor.demo_heat_pump_power', name: 'Heat pump' },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Energy and status shares',
    chart_type: 'donut',
    default_range: 'today',
    entities: [
      { entity: 'sensor.demo_energy', name: 'Heat pump' },
      { entity: 'sensor.demo_hot_water_energy', name: 'Hot water' },
      { entity: 'sensor.demo_heat_pump_status', name: 'Status' },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Outdoor temperature by hour',
    chart_type: 'heatmap',
    default_range: '30d',
    entities: [{ entity: 'sensor.demo_outdoor_temperature', name: 'Outdoor' }],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Heat pump status by hour',
    chart_type: 'heatmap',
    default_range: '7d',
    entities: [{ entity: 'sensor.demo_heat_pump_status', name: 'Status' }],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Solar forecast',
    default_range: 'today',
    entities: [
      { entity: 'sensor.demo_solar_power', name: 'Solar power', color: '#f5a623' },
      {
        entity: 'sensor.demo_pv_forecast',
        color: '#9e9e9e',
        attribute: {
          name: 'detailedForecast',
          values: [
            { key: 'pv_estimate', name: 'Forecast', line_style: 'dashed' },
            { key: 'pv_estimate90', name: 'Forecast 90%', line_style: 'none', fill: 'pv_estimate10', show_in_header: false },
          ],
        },
      },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Solar forecast as areas',
    default_range: 'today',
    entities: [
      { entity: 'sensor.demo_solar_power', name: 'Solar power', color: '#f5a623' },
      {
        entity: 'sensor.demo_pv_forecast',
        color: '#9e9e9e',
        attribute: {
          name: 'detailedForecast',
          values: [
            { key: 'pv_estimate', name: 'Forecast', line_style: 'none', fill: 'zero', fill_opacity: 0.35 },
            { key: 'pv_estimate10', name: 'Forecast 10%', color: '#bdbdbd', line_style: 'none', fill: 'zero', fill_opacity: 0.35 },
          ],
        },
      },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'Heat pump COP',
    chart_type: 'bar',
    period: 'day',
    default_range: 'this_week',
    entities: [
      { entity: 'sensor.demo_heat_pump_heat_space_heating', divide_by: 'sensor.demo_heat_pump_electricity_space_heating', name: 'Heating' },
      { entity: 'sensor.demo_heat_pump_heat_hot_water', divide_by: 'sensor.demo_heat_pump_electricity_hot_water', name: 'Hot water' },
      {
        entity: 'sensor.demo_heat_pump_heat_space_heating',
        add: ['sensor.demo_heat_pump_heat_hot_water'],
        divide_by: ['sensor.demo_heat_pump_electricity_space_heating', 'sensor.demo_heat_pump_electricity_hot_water'],
        name: 'Both',
      },
    ],
  },
  {
    type: 'custom:chart-explorer-card',
    title: 'COP so far today',
    default_range: 'today',
    entities: [
      {
        entity: 'sensor.demo_heat_pump_heat_space_heating',
        add: ['sensor.demo_heat_pump_heat_hot_water'],
        divide_by: ['sensor.demo_heat_pump_electricity_space_heating', 'sensor.demo_heat_pump_electricity_hot_water'],
        name: 'COP',
      },
    ],
  },
);

if (params.get('perf')) {
  // Load check: eight sensors, a week of raw history (161,280 points).
  CONFIGS.splice(0, CONFIGS.length, {
    type: 'custom:chart-explorer-card',
    title: 'Load check',
    default_range: '7d',
    data_source: 'history',
    lightweight: params.get('lightweight') !== '0',
    entities: addLoadEntities(),
  });
}

const hassOptions = {
  delay: Number(params.get('delay') ?? 300),
  fail: params.get('fail') === '1',
  dark,
  language: params.get('lang') ?? 'en-GB',
};
let hass: HomeAssistant = createHass(hassOptions);
(window as unknown as { __wsLog: unknown[] }).__wsLog = [];

const only = params.get('only');
const cards: (HTMLElement & { hass: HomeAssistant; setConfig(c: CardConfigInput): void })[] = [];
CONFIGS.forEach((config, index) => {
  if (only && Number(only) !== index + 1) return;
  const slot = document.createElement('div');
  slot.className = 'slot';
  const card = document.createElement('chart-explorer-card') as (typeof cards)[number];
  card.setConfig(config);
  card.hass = hass;
  slot.appendChild(card);
  document.getElementById('cards')?.appendChild(slot);
  cards.push(card);
});

const log = document.getElementById('log') as HTMLElement;
window.addEventListener('hass-more-info', (event) => {
  log.textContent = `more-info: ${(event as CustomEvent<{ entityId: string }>).detail.entityId}`;
});

// Editor mode: the visual editor beside the first card, with the saved YAML below.
if (params.get('editor')) {
  await import('./ha-stubs');
  await import('../src/editor/editor');
  const cardClass = customElements.get('chart-explorer-card') as unknown as {
    getConfigElement(): Promise<HTMLElement & { hass: HomeAssistant; setConfig(c: CardConfigInput): void }>;
  };
  const editor = await cardClass.getConfigElement();
  editor.hass = hass;
  editor.setConfig(CONFIGS[(Number(only) || 1) - 1]);
  editor.style.cssText = 'display:block;width:480px;padding:12px;border:1px solid var(--divider-color);border-radius:12px;background:var(--card-background-color)';
  const saved = document.createElement('pre');
  saved.id = 'saved-config';
  saved.style.cssText = 'font-size:11px;white-space:pre-wrap';
  editor.addEventListener('config-changed', (event) => {
    const config = (event as CustomEvent<{ config: CardConfigInput }>).detail.config;
    cards[0]?.setConfig(config);
    saved.textContent = JSON.stringify(config, null, 2);
  });
  const container = document.getElementById('cards') as HTMLElement;
  container.style.flexDirection = 'row';
  container.style.alignItems = 'flex-start';
  container.prepend(editor);
  document.body.append(saved);
}

const live = Number(params.get('live') ?? 5);
if (live > 0) {
  setInterval(() => {
    hass = tickHass(hass);
    for (const card of cards) card.hass = hass;
  }, live * 1000);
}
