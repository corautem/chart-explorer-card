import { LitElement, css, html, nothing, svg } from 'lit';
import type { CardConfigInput, EntityConfigInput } from '../config';
import type { HomeAssistant } from '../ha-types';
import { seriesColor, toHex, toRgb } from '../chart/theme';
import { isMissingState, stateColor, type StateColorContext } from '../chart/states';
import { isStateKind, kindSettled, rowKind } from '../rows';
import { DEFAULT_QUICK_RANGES } from '../config';
import { PRESET_IDS } from '../time/range';
import {
  ADD_ENTITY_SCHEMA,
  BARS_SCHEMA,
  CHART_SCHEMA,
  CSV_SCHEMA,
  DATA_SCHEMA,
  ENTITY_HELPERS,
  HELPERS,
  LABELS,
  LAYOUT_SCHEMA,
  PERFORMANCE_SCHEMA,
  STATISTIC_SCHEMA,
  TIMELINE_SCHEMA,
  VALUES_SCHEMA,
  SPACE_SCHEMA,
  X_AXIS_SCHEMA,
  Y_AXIS_SCHEMA,
  entityFromForm,
  entityId,
  entitySchema,
  entityToForm,
  fromForm,
  generalSchema,
  rangeLabel,
  stateColorSchema,
  tidyMenuItems,
  tidyRangeItems,
  toForm,
  type EntityItem,
  type FormData,
} from './schema';

type Tab = 'entities' | 'general' | 'visual' | 'advanced';
type RangeListKey = 'quick_ranges' | 'presets';

const TABS: { id: Tab; label: string }[] = [
  { id: 'entities', label: 'Entities' },
  { id: 'general', label: 'General' },
  { id: 'visual', label: 'Visual' },
  { id: 'advanced', label: 'Advanced' },
];

const UNITS: [string, string][] = [
  ['m', 'minutes'],
  ['h', 'hours'],
  ['d', 'days'],
  ['w', 'weeks'],
  ['mo', 'months'],
  ['y', 'years'],
];

// Material Design Icons paths (Apache-2.0).
const ICONS = {
  pencil:
    'M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z',
  delete: 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z',
  back: 'M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z',
  drag: 'M3,15H21V13H3V15M3,19H21V17H3V19M3,11H21V9H3V11M3,5V7H21V5H3Z',
  expand: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
  collapse: 'M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z',
  check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
  close:
    'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
};

const icon = (name: keyof typeof ICONS) =>
  svg`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${ICONS[name]}></path></svg>`;

/** Grey shown in the picker for a state the card draws striped. */
const STRIPED_SWATCH = '#9e9e9e';

/** The colour the picker shows: the state's colour, or grey for one drawn striped. */
const shownColor = (state: string, context: StateColorContext) => stateColor(state, context) ?? STRIPED_SWATCH;

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): Promise<HTMLElement>;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

/**
 * Makes sure Home Assistant's form elements are registered. They load on
 * demand; opening a built-in card's editor loads them.
 */
async function loadFormElements(): Promise<void> {
  if (customElements.get('ha-form') && customElements.get('ha-entity-picker')) return;
  try {
    const helpers = await window.loadCardHelpers?.();
    const card = await helpers?.createCardElement({ type: 'entities', entities: [] });
    const editorFactory = (card?.constructor as { getConfigElement?: () => Promise<unknown> } | undefined)
      ?.getConfigElement;
    await editorFactory?.();
  } catch {
    // The editor falls back to a note pointing at the code editor.
  }
}

/** A row being dragged: where it started, where it would land, and how far it moved. */
interface Drag {
  from: number;
  to: number;
  pointerId: number;
  startY: number;
  dy: number;
  centres: number[];
  height: number;
}

export class ChartExplorerCardEditor extends LitElement {
  static override properties = { hass: { attribute: false } };

  declare hass?: HomeAssistant;
  private _config?: CardConfigInput;
  private _form: FormData = {};
  private _tab: Tab = 'entities';
  private _editing?: number;
  private _ready = false;
  private _drag?: Drag;
  private _focusHandle?: number;
  /** Which foldable groups are open; all start folded. */
  private readonly _open = new Set<string>();
  /** States each entity had in the last 30 days, and states typed in, for the state colours. */
  private readonly _seenStates = new Map<string, string[]>();
  private readonly _addedStates = new Map<string, string[]>();
  private readonly _fetching = new Set<string>();

  public setConfig(config: CardConfigInput): void {
    this._config = config;
    this._form = toForm(config);
    if (this._editing !== undefined && this._editing >= (config.entities?.length ?? 0)) this._editing = undefined;
    this.requestUpdate();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._ready) {
      void loadFormElements().then(() => {
        this._ready = true;
        this.requestUpdate();
      });
    }
  }

  protected override updated(): void {
    if (this._focusHandle !== undefined) {
      this.renderRoot.querySelectorAll<HTMLElement>('.entities .handle')[this._focusHandle]?.focus();
      this._focusHandle = undefined;
    }
  }

  private get _entities(): EntityItem[] {
    return this._config?.entities ?? [];
  }

  private get _dark(): boolean {
    return Boolean(this.hass?.themes?.darkMode);
  }

  /** Saves the form and entity list as the card config and tells Home Assistant. */
  private _commit(entities: EntityItem[] = this._entities): void {
    if (!this._config) return;
    const config = fromForm(this._form, this._config, entities);
    this._config = config;
    this._form = toForm(config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  private _label = (schema: { name: string }) => LABELS[schema.name] ?? schema.name;
  private _helper = (schema: { name: string }) => HELPERS[schema.name];
  private _entityHelper = (schema: { name: string }) => ENTITY_HELPERS[schema.name] ?? HELPERS[schema.name];

  private _onSettings = (event: CustomEvent<{ value: FormData }>): void => {
    event.stopPropagation();
    const next = { ...this._form, ...event.detail.value };
    // Animations follow lightweight mode until they are set on their own.
    if (
      next.lightweight !== this._form.lightweight &&
      next.animation === this._form.animation &&
      this._config?.animation === undefined
    ) {
      next.animation = !next.lightweight;
    }
    this._form = next;
    this._commit();
  };

  private _settingsForm(schema: unknown[]) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${this._form}
      .schema=${schema}
      .computeLabel=${this._label}
      .computeHelper=${this._helper}
      @value-changed=${this._onSettings}
    ></ha-form>`;
  }

  private _select(tab: Tab): void {
    this._tab = tab;
    this._editing = undefined;
    this.requestUpdate();
  }

  protected override render() {
    if (!this._config) return nothing;
    if (!this._ready) return html`<div class="note">Loading…</div>`;
    if (!customElements.get('ha-form')) {
      return html`<div class="note">This editor needs Home Assistant's form elements. Use the code editor instead.</div>`;
    }
    return html`
      <div class="tabs" role="tablist">
        ${TABS.map(
          (tab) => html`<button
            role="tab"
            class=${this._tab === tab.id ? 'active' : ''}
            aria-selected=${this._tab === tab.id ? 'true' : 'false'}
            @click=${() => this._select(tab.id)}
          >
            ${tab.label}
          </button>`,
        )}
      </div>
      <div class="panel" role="tabpanel">${this._renderTab()}</div>
    `;
  }

  private _renderTab() {
    switch (this._tab) {
      case 'entities':
        return this._editing === undefined ? this._renderEntityList() : this._renderEntityEditor(this._editing);
      case 'general':
        return html`
          ${this._settingsForm(generalSchema(this._form))}
          ${this._form.chart_type === 'bar' || this._entities.some((item) => typeof item !== 'string' && item.type === 'bar')
            ? this._group('bars', 'Bars', this._settingsForm(BARS_SCHEMA))
            : nothing}
          ${this._group('toolbar-buttons', 'Quick ranges', this._renderRangeList('quick_ranges'))}
          ${this._group('menu-entries', 'Menu entries', this._renderRangeList('presets'))}
          ${this._group('toolbar', 'Toolbar', this._settingsForm(LAYOUT_SCHEMA))}
        `;
      case 'visual':
        return html`
          ${this._group('values', 'Values', this._settingsForm(VALUES_SCHEMA))}
          ${this._group('chart', 'Chart', this._settingsForm(CHART_SCHEMA))}
          ${this._group('space', 'Height and space inside the chart', this._settingsForm(SPACE_SCHEMA))}
          ${this._group('timeline', 'Timeline strips', this._settingsForm(TIMELINE_SCHEMA))}
          ${this._group('x-axis', 'X-axis (time)', this._settingsForm(X_AXIS_SCHEMA))}
          ${this._group('y-axis', 'Y-axis (values)', this._settingsForm(Y_AXIS_SCHEMA))}
        `;
      case 'advanced':
        return html`
          ${this._group('performance', 'Performance', this._settingsForm(PERFORMANCE_SCHEMA))}
          ${this._group(
            'data',
            'Data',
            html`<p class="note">
                Raw history holds every recorded change, for as long as the recorder keeps it (10 days unless
                changed). Statistics hold 5-minute and hourly averages for longer. The card uses raw history where it
                still exists and fills older parts from statistics by itself.
              </p>
              ${this._settingsForm(DATA_SCHEMA)}`,
          )}
          <h3 class="single">Long windows</h3>
          ${this._settingsForm(STATISTIC_SCHEMA)}
          ${this._group('csv', 'CSV export', this._settingsForm(CSV_SCHEMA))}
        `;
    }
  }

  /** A group of settings that folds away; it starts folded. */
  private _group(id: string, title: string, content: unknown) {
    const open = this._open.has(id);
    return html`
      <div class="group ${open ? 'open' : ''}" data-group=${id}>
        <button
          class="group-head"
          aria-expanded=${open ? 'true' : 'false'}
          @click=${() => {
            if (open) this._open.delete(id);
            else this._open.add(id);
            this.requestUpdate();
          }}
        >
          <span>${title}</span>${icon(open ? 'collapse' : 'expand')}
        </button>
        ${open ? html`<div class="group-body">${content}</div>` : nothing}
      </div>
    `;
  }

  // ---- Quick ranges and menu entries ----

  private _lists(key: RangeListKey) {
    const unusedKey = key === 'quick_ranges' ? 'unused_quick_ranges' : 'unused_presets';
    const defaults: readonly string[] = key === 'quick_ranges' ? DEFAULT_QUICK_RANGES : PRESET_IDS;
    const tidy = key === 'quick_ranges' ? tidyRangeItems : tidyMenuItems;
    const selected = tidy(this._form[key]);
    const unused = tidyRangeItems(this._form[unusedKey]).filter((id) => !selected.includes(id));
    const custom = tidyRangeItems([...selected.filter((id) => !defaults.includes(id)), ...unused]);
    return { unusedKey, defaults, tidy, selected, unused, custom };
  }

  private _saveLists(key: RangeListKey, selected: string[], unused: string[]): void {
    const { unusedKey, tidy } = this._lists(key);
    this._form = { ...this._form, [key]: tidy(selected), [unusedKey]: tidyRangeItems(unused) };
    this._commit();
  }

  /** Standard entries switch on and off; custom ones too, and switched off they wait in the unused list. */
  private _toggleRange(key: RangeListKey, id: string): void {
    const { defaults, selected, unused } = this._lists(key);
    if (selected.includes(id)) {
      this._saveLists(key, selected.filter((x) => x !== id), defaults.includes(id) ? unused : [...unused, id]);
    } else {
      this._saveLists(key, [...selected, id], unused.filter((x) => x !== id));
    }
  }

  private _deleteRange(key: RangeListKey, id: string): void {
    const { selected, unused } = this._lists(key);
    this._saveLists(key, selected.filter((x) => x !== id), unused.filter((x) => x !== id));
  }

  private _addLength(key: RangeListKey, event: Event): void {
    const row = (event.currentTarget as HTMLElement).closest('.add-range');
    const amountInput = row?.querySelector<HTMLInputElement>('.amount');
    const unit = row?.querySelector<HTMLSelectElement>('.unit')?.value ?? 'h';
    const ahead = row?.querySelector<HTMLSelectElement>('.direction')?.value === 'next';
    const amount = Number(amountInput?.value);
    if (!Number.isInteger(amount) || amount < 1) {
      amountInput?.focus();
      return;
    }
    if (amountInput) amountInput.value = '';
    const id = tidyRangeItems([`${ahead ? '+' : ''}${amount}${unit}`])[0];
    const { selected, unused } = this._lists(key);
    if (!id || selected.includes(id)) return;
    this._saveLists(key, [...selected, id], unused.filter((x) => x !== id));
  }

  /**
   * A list's standard entries as buttons that switch on and off, then custom
   * lengths in another shade, which switch too and can be deleted, then the row
   * that adds a length.
   */
  private _renderRangeList(key: RangeListKey) {
    const { defaults, selected, custom } = this._lists(key);
    const chip = (id: string, isCustom: boolean) => {
      const on = selected.includes(id);
      const label = rangeLabel(id);
      return html`<span class="toggle ${on ? 'on' : ''} ${isCustom ? 'custom' : ''}">
        <button
          class="toggle-main"
          aria-pressed=${on ? 'true' : 'false'}
          title=${on ? 'Shown: tap to hide' : 'Hidden: tap to show'}
          @click=${() => this._toggleRange(key, id)}
        >
          ${on ? icon('check') : nothing}${label}
        </button>
        ${isCustom
          ? html`<button class="chip-remove" title="Delete" aria-label="Delete ${label}" @click=${() => this._deleteRange(key, id)}>
              ${icon('close')}
            </button>`
          : nothing}
      </span>`;
    };
    return html`
      <div class="range-list" data-list=${key}>
        <div class="list-help">
          ${key === 'quick_ranges'
            ? 'Buttons at the top of the Presets menu, each a rolling window that ends now. Tap one to show or hide it.'
            : 'Entries in the Presets menu, above Custom. Tap one to show or hide it. Next lengths run from now into the future, for forecasts.'}
          Lengths you add appear after these in a different shade; × deletes them.
        </div>
        <div class="chips">${defaults.map((id) => chip(id, false))}${custom.map((id) => chip(id, true))}</div>
        <div class="add-range">
          ${key === 'presets'
            ? html`<select class="direction" aria-label="Past or next">
                <option value="past">Past</option>
                <option value="next">Next</option>
              </select>`
            : html`<span class="past">Past</span>`}
          <input class="amount" type="number" min="1" step="1" placeholder="45" aria-label="Length" />
          <select class="unit" aria-label="Unit">
            ${UNITS.map(([value, label]) => html`<option value=${value} ?selected=${value === 'm'}>${label}</option>`)}
          </select>
          <button class="add-length" @click=${(event: Event) => this._addLength(key, event)}>Add length</button>
        </div>
      </div>
    `;
  }

  // ---- Entities ----

  private _onAdd = (event: CustomEvent<{ value: FormData }>): void => {
    event.stopPropagation();
    const id = event.detail.value?.entity;
    if (typeof id !== 'string' || !id) return;
    this._commit([...this._entities, id]);
  };

  private _onEntity(event: CustomEvent<{ value: FormData }>, index: number): void {
    event.stopPropagation();
    const entities = [...this._entities];
    entities[index] = entityFromForm(event.detail.value, entities[index], seriesColor(index, this._dark).color);
    this._commit(entities);
  }

  private _moveTo(from: number, to: number): void {
    const entities = [...this._entities];
    const [item] = entities.splice(from, 1);
    entities.splice(to, 0, item);
    this._commit(entities);
  }

  private _remove(index: number): void {
    const entities = [...this._entities];
    entities.splice(index, 1);
    this._editing = undefined;
    this._commit(entities);
  }

  private _edit(index: number): void {
    this._editing = index;
    this.requestUpdate();
  }

  private _closeEditor = (): void => {
    this._editing = undefined;
    this.requestUpdate();
  };

  private _displayName(item: EntityItem): string {
    const id = entityId(item);
    const name = typeof item === 'string' ? undefined : item.name;
    return name ?? this.hass?.states[id]?.attributes.friendly_name ?? id;
  }

  // Dragging works with mouse and touch through pointer events; the handle
  // also moves its row with the arrow keys.
  private _dragStart(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('.entities .row')];
    const rects = rows.map((row) => row.getBoundingClientRect());
    this._drag = {
      from: index,
      to: index,
      pointerId: event.pointerId,
      startY: event.clientY,
      dy: 0,
      centres: rects.map((rect) => rect.top + rect.height / 2),
      height: rects[index]?.height ?? 0,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this.requestUpdate();
  }

  private _dragMove(event: PointerEvent): void {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.dy = event.clientY - drag.startY;
    const centre = drag.centres[drag.from] + drag.dy;
    drag.to = drag.centres.filter((other, i) => i !== drag.from && other < centre).length;
    this.requestUpdate();
  }

  private _dragEnd(event: PointerEvent): void {
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this._drag = undefined;
    if (drag.to !== drag.from) this._moveTo(drag.from, drag.to);
    else this.requestUpdate();
  }

  private _handleKey(event: KeyboardEvent, index: number): void {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const to = index + by;
    if (!by || to < 0 || to >= this._entities.length) return;
    event.preventDefault();
    this._focusHandle = to;
    this._moveTo(index, to);
  }

  /** How far a row shifts while another is dragged past it. */
  private _rowShift(index: number): string {
    const drag = this._drag;
    if (!drag) return '';
    if (index === drag.from) return `transform:translateY(${drag.dy}px)`;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return `transform:translateY(${-drag.height}px)`;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return `transform:translateY(${drag.height}px)`;
    return 'transform:none';
  }

  private _renderEntityList() {
    const entities = this._entities;
    return html`
      <div class="add">
        <ha-form
          .hass=${this.hass}
          .data=${{ entity: '' }}
          .schema=${ADD_ENTITY_SCHEMA}
          .computeLabel=${() => 'Add an entity'}
          @value-changed=${this._onAdd}
        ></ha-form>
      </div>
      <div class="entities ${this._drag ? 'dragging' : ''}">
        ${entities.length
          ? entities.map((item, index) => this._renderEntityRow(item, index))
          : html`<div class="note">No entities yet. Search for one above.</div>`}
      </div>
      ${entities.length > 1 ? html`<p class="note">Drag the handle to reorder, or focus it and use the arrow keys.</p>` : nothing}
    `;
  }

  private _renderEntityRow(item: EntityItem, index: number) {
    const color = (typeof item === 'string' ? undefined : item.color) ?? seriesColor(index, this._dark).color;
    const name = this._displayName(item);
    const lifted = this._drag?.from === index;
    return html`
      <div class="row ${lifted ? 'lifted' : ''}" style=${this._rowShift(index)}>
        <span
          class="handle"
          role="button"
          tabindex="0"
          title="Drag to reorder"
          aria-label="Reorder ${name}"
          @pointerdown=${(event: PointerEvent) => this._dragStart(event, index)}
          @pointermove=${(event: PointerEvent) => this._dragMove(event)}
          @pointerup=${(event: PointerEvent) => this._dragEnd(event)}
          @pointercancel=${(event: PointerEvent) => this._dragEnd(event)}
          @keydown=${(event: KeyboardEvent) => this._handleKey(event, index)}
        >
          ${icon('drag')}
        </span>
        <span class="swatch" style=${`background:${color}`}></span>
        <button class="row-text" title="Edit ${name}" @click=${() => this._edit(index)}>
          <span class="row-name">${name}</span>
          <span class="row-id">${entityId(item)}</span>
        </button>
        <button class="icon" title="Edit" aria-label="Edit ${name}" @click=${() => this._edit(index)}>
          ${icon('pencil')}
        </button>
        <button class="icon" title="Remove" aria-label="Remove ${name}" @click=${() => this._remove(index)}>
          ${icon('delete')}
        </button>
      </div>
    `;
  }

  private _entityForm(schema: unknown[], item: EntityItem, index: number, defaultColor: string) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${entityToForm(item, defaultColor)}
      .schema=${schema}
      .computeLabel=${this._label}
      .computeHelper=${this._entityHelper}
      @value-changed=${(event: CustomEvent<{ value: FormData }>) => this._onEntity(event, index)}
    ></ha-form>`;
  }

  private _renderEntityEditor(index: number) {
    const item = this._entities[index];
    if (item === undefined) return this._renderEntityList();
    const defaultColor = seriesColor(index, this._dark).color;
    const id = entityId(item);
    const type = typeof item === 'string' ? undefined : item.type;
    const chartType = (this._form.chart_type as CardConfigInput['chart_type']) ?? 'line';
    const stateObj = this.hass?.states[id];
    // States recorded in the last 30 days decide for a sensor that is unavailable or unknown right now.
    const recorded = this._seenStates.get(id);
    const kind = rowKind(type, chartType, stateObj, recorded);
    const autoKind = rowKind('auto', chartType, stateObj, recorded);
    if (!kindSettled('auto', stateObj, recorded) && !this._seenStates.has(id) && !this._fetching.has(id)) this._fetchStates(id);
    const states = isStateKind(kind) ? this._knownStates(item) : [];
    return html`
      <div class="edit-head">
        <button class="back" @click=${this._closeEditor}>${icon('back')}<span>All entities</span></button>
        <span class="edit-title">${this._displayName(item)}</span>
      </div>
      ${this._entityForm(entitySchema(kind, autoKind, states), item, index, defaultColor)}
      ${isStateKind(kind) ? this._renderStateColors(item, index, states) : nothing}
      <div class="edit-actions">
        <button class="danger" @click=${() => this._remove(index)}>${icon('delete')}<span>Remove this entity</span></button>
      </div>
    `;
  }

  /**
   * States the entity can have, in the order the editor lists them: the
   * entity's own list of states (if it has one) in that order; then states it
   * is in now, states with a colour or a band setting, states recorded in the
   * last 30 days and states added by hand, A to Z by the name shown; then
   * Unavailable and Unknown, which are striped until they get a colour.
   */
  private _knownStates(item: EntityItem): string[] {
    const id = entityId(item);
    const e = typeof item === 'string' ? undefined : item;
    const stateObj = this.hass?.states[id];
    const options = Array.isArray(stateObj?.attributes.options) ? (stateObj?.attributes.options as unknown[]).map(String) : [];
    const found = new Set<string>();
    if (stateObj) found.add(stateObj.state);
    for (const state of Object.keys(e?.state_colors ?? {})) found.add(state);
    for (const state of e?.on_states ?? []) found.add(state);
    for (const state of this._seenStates.get(id) ?? []) found.add(state);
    for (const state of this._addedStates.get(id) ?? []) found.add(state);
    if (!this._seenStates.has(id) && !this._fetching.has(id)) this._fetchStates(id);
    const label = (state: string) => this._stateName(id, state);
    const others = [...found]
      .filter((state) => !isMissingState(state) && !options.includes(state))
      .sort((a, b) => label(a).localeCompare(label(b)));
    // A sensor with free text could have hundreds; the first 40 are plenty to pick colours for.
    return [...options.filter((state) => !isMissingState(state)), ...others].slice(0, 40).concat(['unavailable', 'unknown']);
  }

  /** A state as Home Assistant shows it, such as "Standby". */
  private _stateName(id: string, state: string): string {
    const stateObj = this.hass?.states[id];
    return stateObj && this.hass?.formatEntityState ? this.hass.formatEntityState(stateObj, state) : state;
  }

  /** Adds a state typed by hand, so it can get a colour before it has happened. */
  private _addState(id: string, event: Event): void {
    const input = (event.currentTarget as HTMLElement).closest('.add-state')?.querySelector<HTMLInputElement>('input');
    const state = input?.value.trim();
    if (!input || !state) {
      input?.focus();
      return;
    }
    input.value = '';
    const added = this._addedStates.get(id) ?? [];
    if (!added.includes(state)) this._addedStates.set(id, [...added, state]);
    this.requestUpdate();
  }

  private _fetchStates(id: string): void {
    const hass = this.hass;
    if (!hass) return;
    this._fetching.add(id);
    const now = Date.now();
    hass
      .callWS<Record<string, { s: string }[] | undefined>>({
        type: 'history/history_during_period',
        start_time: new Date(now - 30 * 86_400_000).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: [id],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: true,
      })
      .then((reply) => this._seenStates.set(id, [...new Set((reply?.[id] ?? []).map((row) => row.s))]))
      .catch(() => this._seenStates.set(id, []))
      .finally(() => {
        this._fetching.delete(id);
        this.requestUpdate();
      });
  }

  private _colorContext(item: EntityItem, index: number, overrides: Record<string, string>): StateColorContext {
    const e = typeof item === 'string' ? undefined : item;
    const options = this.hass?.states[entityId(item)]?.attributes.options;
    return {
      overrides,
      entityColor: e?.color ?? seriesColor(index, this._dark).color,
      // The card draws quiet states in a see-through grey; the picker shows it solid.
      neutral: this._dark ? '#5f5f5f' : '#bdbdbd',
      dark: this._dark,
      options: Array.isArray(options) ? options.map(String) : undefined,
    };
  }

  private _renderStateColors(item: EntityItem, index: number, states: string[]) {
    const id = entityId(item);
    const overrides = (typeof item === 'string' ? undefined : item.state_colors) ?? {};
    const context = this._colorContext(item, index, overrides);
    const data: FormData = {};
    for (const state of states) data[`state:${state}`] = toRgb(shownColor(state, context));
    const label = (schema: { name: string }) => {
      const state = schema.name.slice('state:'.length);
      const name = this._stateName(id, state);
      return isMissingState(state) && !overrides[state] ? `${name} (striped)` : name;
    };
    const content = html`
      <p class="list-help">
        Each state keeps its colour. Quiet states such as off and standby are grey until you pick a colour; other states
        get one from their name. Listed first are the entity's own states if it has a list, then the states recorded in
        the last 30 days, A to Z, then Unavailable and Unknown.
      </p>
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${stateColorSchema(states)}
        .computeLabel=${label}
        @value-changed=${(event: CustomEvent<{ value: FormData }>) => this._onStateColors(event, index, states)}
      ></ha-form>
      <div class="add-state">
        <input type="text" aria-label="State to add" placeholder="Another state, as recorded (such as defrost)" />
        <button @click=${(event: Event) => this._addState(id, event)}>Add</button>
      </div>
      ${Object.keys(overrides).length
        ? html`<button class="reset-colors" @click=${() => this._resetStateColors(index)}>Back to automatic colours</button>`
        : nothing}
    `;
    return this._group('state-colors', 'State colours', content);
  }

  /** Saves only the colours that differ from the automatic ones. */
  private _onStateColors(event: CustomEvent<{ value: FormData }>, index: number, states: string[]): void {
    event.stopPropagation();
    const entities = [...this._entities];
    const item = entities[index];
    const e: EntityConfigInput = typeof item === 'string' ? { entity: item } : { ...item };
    const automatic = this._colorContext(item, index, {});
    const colors: Record<string, string> = {};
    for (const [state, color] of Object.entries(e.state_colors ?? {})) if (!states.includes(state)) colors[state] = color;
    for (const state of states) {
      const rgb = event.detail.value[`state:${state}`];
      if (!Array.isArray(rgb)) continue;
      const hex = toHex(rgb as number[]);
      if (hex !== toHex(toRgb(shownColor(state, automatic)) ?? [0, 0, 0])) colors[state] = hex;
    }
    if (Object.keys(colors).length) e.state_colors = colors;
    else delete e.state_colors;
    entities[index] = Object.keys(e).length === 1 ? e.entity : e;
    this._commit(entities);
  }

  private _resetStateColors(index: number): void {
    const entities = [...this._entities];
    const item = entities[index];
    if (typeof item === 'string') return;
    const e = { ...item };
    delete e.state_colors;
    entities[index] = Object.keys(e).length === 1 ? e.entity : e;
    this._commit(entities);
  }

  static override styles = css`
    :host {
      display: block;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--divider-color);
      margin-bottom: 12px;
      overflow-x: auto;
    }
    .tabs button {
      flex: 1;
      font: inherit;
      font-weight: 500;
      color: var(--secondary-text-color);
      background: none;
      border: 0;
      border-bottom: 2px solid transparent;
      padding: 10px 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tabs button.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }
    button:focus-visible,
    .handle:focus-visible,
    select:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 1px;
    }
    h3 {
      font-size: 14px;
      font-weight: 500;
      margin: 18px 0 4px;
      color: var(--primary-text-color);
    }
    h3:first-child {
      margin-top: 0;
    }
    .add-state {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .add-state input {
      flex: 1;
      min-width: 0;
      font: inherit;
      padding: 6px 8px;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      background: none;
      color: var(--primary-text-color);
    }
    .add-state button {
      font: inherit;
      padding: 6px 14px;
      border-radius: 16px;
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-color);
      cursor: pointer;
    }
    .reset-colors {
      font: inherit;
      font-size: 13px;
      margin-top: 8px;
      padding: 6px 12px;
      border-radius: 16px;
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-color);
      cursor: pointer;
    }
    .note,
    .list-help {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.45;
      margin: 4px 0 8px;
    }
    .add {
      margin-bottom: 8px;
    }
    .entities {
      position: relative;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0;
      border-bottom: 1px solid var(--divider-color);
      background: var(--card-background-color, var(--primary-background-color));
      transition: transform 0.15s ease;
      position: relative;
    }
    .row.lifted {
      transition: none;
      z-index: 2;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      border-radius: 6px;
    }
    .handle {
      flex: none;
      width: 32px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--secondary-text-color);
      cursor: grab;
      touch-action: none;
      border-radius: 6px;
    }
    .dragging .handle {
      cursor: grabbing;
    }
    .swatch {
      flex: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      margin: 0 6px 0 2px;
    }
    .row-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      background: none;
      border: 0;
      padding: 2px 0;
      font: inherit;
      text-align: left;
      cursor: pointer;
      color: var(--primary-text-color);
    }
    .row-name,
    .row-id {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-id {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    button.icon {
      flex: none;
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 0;
      border-radius: 50%;
      color: var(--secondary-text-color);
      cursor: pointer;
    }
    button.icon:hover {
      background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
      color: var(--primary-text-color);
    }
    svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .range-list {
      margin: 16px 0;
    }
    .list-title {
      font-size: 14px;
      color: var(--primary-text-color);
      margin-bottom: 6px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 13px;
      padding: 2px 2px 2px 10px;
      border-radius: 16px;
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
      color: var(--primary-text-color);
    }
    .chip-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
    }
    .chip-remove svg {
      width: 16px;
      height: 16px;
    }
    .sub-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--secondary-text-color);
      margin: 10px 0 6px;
    }
    .sub-title .note {
      font-weight: 400;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      height: 30px;
      border-radius: 16px;
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
    }
    .toggle.on {
      border-color: transparent;
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.18);
    }
    /* Lengths you added: an amber shade, so they stand apart from the standard ones. */
    .toggle.custom {
      border-color: rgba(var(--rgb-warning-color, 255, 166, 0), 0.6);
    }
    .toggle.custom.on {
      border-color: transparent;
      background: rgba(var(--rgb-warning-color, 255, 166, 0), 0.22);
    }
    .toggle-main {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 100%;
      font: inherit;
      font-size: 13px;
      padding: 0 12px;
      border: 0;
      border-radius: 16px;
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .toggle.custom .toggle-main {
      padding-right: 2px;
    }
    .toggle-main svg {
      width: 16px;
      height: 16px;
      margin-left: -4px;
    }
    .past {
      font-size: 14px;
      color: var(--primary-text-color);
    }
    .group {
      border-bottom: 1px solid var(--divider-color);
    }
    .group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px 4px;
      font: inherit;
      font-size: 15px;
      font-weight: 500;
      color: var(--primary-text-color);
      background: none;
      border: 0;
      cursor: pointer;
      text-align: left;
    }
    .group-body {
      padding: 0 0 14px;
    }
    h3.single {
      margin: 16px 4px 4px;
    }
    .add-range {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .add-range input,
    .add-range select,
    .add-range button {
      font: inherit;
      font-size: 14px;
      height: 36px;
      box-sizing: border-box;
      border: 1px solid var(--divider-color);
      border-radius: 6px;
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    .add-range .amount {
      width: 72px;
    }
    .add-range button {
      color: var(--primary-color);
      cursor: pointer;
    }
    .edit-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .back,
    .danger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: inherit;
      background: none;
      border: 0;
      border-radius: 6px;
      padding: 6px 8px;
      cursor: pointer;
      color: var(--primary-color);
    }
    .edit-title {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .edit-actions {
      margin-top: 16px;
      display: flex;
      justify-content: flex-end;
    }
    .danger {
      color: var(--error-color, #db4437);
    }
  `;
}

if (!customElements.get('chart-explorer-card-editor')) {
  customElements.define('chart-explorer-card-editor', ChartExplorerCardEditor);
}
