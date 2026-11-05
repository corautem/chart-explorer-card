import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { normalizeConfig, type CardConfig, type CardConfigInput, type EntityConfig } from './config';
import type { HassEntity, HomeAssistant, LovelaceGridOptions } from './ha-types';
import { NumberFormatter, decimalsOf, stateToNumber } from './number';
import { DAY, HOUR, MINUTE } from './time/duration';
import { TimeFormatter, fromDatetimeLocal, toDatetimeLocal } from './time/format';
import {
  containsNow,
  labelEndIsInclusive,
  nowSpec,
  presetOf,
  rangeItemActive,
  rangeItemSpec,
  resolveWindow,
  stepSpec,
  type RangeItem,
  type RangeSpec,
  type TimeWindow,
} from './time/range';
import { addUnits, followsCalendar, slides, startOfUnit } from './time/range';
import { resolveWeekStart } from './time/week';
import { MetaCache, WindowCache, cacheKey, canReuse, entityKey, loadWindow, mergeShifted, rawFrom, seriesFor, type LoadInput } from './data/loader';
import { bucketAt, bucketPeriodFor, bucketValues, periodEdges, windowValue } from './data/buckets';
import { attributeSeries, isListValue, sliceSeries, suggestedListUnit, type AttributeSeries } from './data/attribute';
import { attributeKey } from './data/history';
import { ratioPeriods, runningRatio, windowRatio, type RatioPart, type RatioPeriods } from './data/ratio';
import { inCommonUnits, sameFamily, unitFactor } from './units';
import { chooseResolution } from './data/resolution';
import { appendPoint, decimate, holdValues, indexAtOrBefore, stateAt, trimBefore, valueAt } from './data/series';
import type { BucketPeriod, LoadedData, Resolution, Series } from './data/types';
import { init, type EChartsType } from './chart/echarts';
import {
  buildOption,
  placeBars,
  timeLabelHeight,
  timelineHeight,
  type PlotAxis,
  type PlotBand,
  type PlotBar,
  type PlotInput,
  type PlotSeries,
  type PlotTimelineRow,
} from './chart/timeseries';
import { buildPieOption, pieCentre, type PlotPie } from './chart/pie';
import { buildHeatmapOption, heatColor, valueRange, type HeatCell } from './chart/heatmap';
import { isMissingState, isOnState, isQuietState, stateColor } from './chart/states';
import { mainState, periodStates, stateDurations, timelineSegments, type PeriodStates } from './chart/timeline';
import { readTheme, seriesColor, shadeColor, withAlpha, type Theme } from './chart/theme';
import { InteractionController, type InteractionHost } from './chart/interaction';
import { isStateKind, kindSettled, rowKind, type RowKind } from './rows';
import { buildCsv, buildPieCsv, type CsvColumn, type CsvSlice } from './export/csv';
import { saveFile } from './export/download';
import { exportFileName } from './export/filename';
import { chartPng } from './export/png';
import { buttonLabel, menuLabel, presetName, t, type StringKey } from './localize';
import { icon } from './ui/icons';
import { cardStyles } from './ui/styles';

const VERSION = '0.8.3';
// The chart's inner edge and ECharts' gap between numbers and the plot, in pixels.
const GRID_EDGE = 4;
const LABEL_MARGIN = 8;
const MAX_ZOOM_LEVELS = 10;

type Menu = 'presets' | 'export' | 'custom';

interface ZoomLevel {
  spec: RangeSpec;
  data?: LoadedData;
}

interface RowView {
  row: EntityConfig;
  name: string;
  color: string;
  dashed: boolean;
  unit: string;
  decimals?: number;
}

interface Reading {
  text: string;
  unit?: string;
  numeric: boolean;
  title?: string;
  /** Colour of the value when it is not the entity colour: the colour of a state. */
  color?: string;
}

/** A row's values per period, as bars, pie totals or heatmap cells use them. */
interface RowBuckets {
  t: number[];
  end: number[];
  v: number[];
  meanType: boolean;
}

interface HeatScale {
  min: string;
  max: string;
  from: string;
  to: string;
}

/** A heatmap of an entity with states: the hours, their cells and the states that lead an hour, most hours first. */
interface StateHeat {
  key: string;
  periods: PeriodStates[];
  cells: HeatCell[];
  states: string[];
}

interface HeatKeyItem {
  label: string;
  /** None for a striped state (unavailable or unknown without a colour). */
  color?: string;
}

interface PieRow {
  row: EntityConfig;
  /** In the entity's own unit, as the values row and the CSV show it. */
  value: number;
  /** In one unit per family (W and kW alike), as the slice is drawn. */
  drawn: number;
  share: number;
}

export class ChartExplorerCard extends LitElement {
  static override styles = cardStyles;

  private _config?: CardConfig;
  private _dataKey?: string;
  private _hass?: HomeAssistant;
  private _spec?: RangeSpec;
  private _window?: TimeWindow;
  private _zoomLevels: ZoomLevel[] = [];
  /** The window shown while a drag or pinch is under way. */
  private _preview?: TimeWindow;
  /** The margin being loaded around a gesture, at most one at a time. */
  private _extLoad?: { window: TimeWindow; resolution: Resolution };
  private _gestureLoading = false;
  private _frame?: number;
  /** Units drawn above each scale's numbers, centred on them. */
  private _unitLabels: { text: string; x: number }[] = [];
  /** The spec the last gesture set, so further gestures do not add more ways back. */
  private _gestureSpec?: RangeSpec;
  private _data?: LoadedData;
  /** Bumped whenever the data changes, so memoised series are rebuilt. */
  private _version = 0;
  private _stateHeatMemo?: StateHeat;
  /** Lists read from attributes, kept until the attribute changes. */
  private readonly _attributeMemo = new Map<string, { raw: unknown; series: AttributeSeries }>();
  private readonly _ratioMemo = new Map<string, { version: number; ratio: RatioPeriods }>();
  private readonly _seriesMemo = new Map<string, { version: number; series: Series }>();
  private _loading = false;
  private _slow = false;
  private _error?: string;
  private _faded = new Set<string>();
  private _cursor?: number;
  private _menu?: Menu;
  private _customFrom = '';
  private _customTo = '';
  private _customError?: string;
  /** 0 full toolbar, 1 two-line label, 2 short name on the menu button, 3 label may be cut short. */
  private _toolbarLevel = 0;
  private readonly _levelWidths: number[] = [];

  private _chart?: EChartsType;
  private _gestures?: InteractionController;
  private _resizeObserver?: ResizeObserver;
  private _observedToolbar?: Element;
  private _intersection?: IntersectionObserver;
  private _onScreen = true;
  private _hiddenSince?: number;
  private _dirty = false;
  private _lastDraw = 0;
  private _chartWidth = 0;
  private _drawTimer?: number;
  private _loadTimer?: number;
  private _slowTimer?: number;
  private _minuteTimer?: number;
  private _minuteAlign?: number;
  private _releaseTimer?: number;
  private _cursorFrame?: number;
  private _requestId = 0;
  private _meta = new MetaCache();
  private readonly _cache = new WindowCache(6);
  private readonly _seen = new Map<string, HassEntity | undefined>();
  private _theme?: Theme;
  private _dark = false;
  private _localeKey?: string;
  private _times = new TimeFormatter('en');
  private _numbers = new NumberFormatter({ language: 'en' });
  private _weekStart = 1;
  /** How each row is drawn, worked out once Home Assistant's states are known. */
  private readonly _kinds = new Map<string, RowKind>();
  private readonly _stateLabels = new Map<string, string>();
  private readonly _bucketMemo = new Map<string, { version: number; buckets?: RowBuckets }>();
  /** Edges of the plot above the timeline strips, measured after each layout. */
  private _inset?: { left: number; right: number };
  /** Entity names under each pie when there are several. */
  private _pieNames: { text: string; x: number }[] = [];
  private _refreshing = false;

  // ---- Home Assistant card API ----

  public setConfig(input: CardConfigInput): void {
    const config = normalizeConfig(input);
    const previous = this._config;
    // What decides the data to load: which entities, and the data settings.
    const dataKey = JSON.stringify([
      [...new Set(config.entities.map((row) => row.entity))].sort(),
      config.data,
      config.chartType,
      config.period,
      config.entities.map((row) => row.type),
      config.entities.map((row) => row.attribute?.name ?? ''),
      config.entities.map((row) => (row.ratio ? [...row.ratio.add, ...row.ratio.divideBy] : [])),
      config.entities.map((row) => [row.timeShift ?? 0, row.showInChart]),
    ]);
    const sameData = previous !== undefined && dataKey === this._dataKey;
    this._config = config;
    this._dataKey = dataKey;
    this._toolbarLevel = 0;
    this._levelWidths.length = 0;
    this._seriesMemo.clear();
    this._bucketMemo.clear();
    this._kinds.clear();
    this._inset = undefined;
    this._version++;

    if (sameData) {
      // Only the look changed, as on most edits in the card editor: keep the
      // data, the window and the zoom, and apply the new settings.
      config.entities.forEach((row, i) => {
        if (row.faded !== previous.entities[i]?.faded) {
          if (row.faded) this._faded.add(row.key);
          else this._faded.delete(row.key);
        }
      });
      if (JSON.stringify(config.defaultRange) !== JSON.stringify(previous.defaultRange) && this._hass) {
        this._applySpec(config.defaultRange, true, 0);
      }
      this.requestUpdate();
      this._requestDraw(true);
      return;
    }

    this._faded = new Set(config.entities.filter((row) => row.faded).map((row) => row.key));
    this._zoomLevels = [];
    this._data = undefined;
    this._cache.clear();
    this._meta = new MetaCache();
    this._seen.clear();
    this._error = undefined;
    this._spec = config.defaultRange;
    this._window = undefined;
    if (this._hass) {
      this._statesChanged(this._hass);
      this._applySpec(config.defaultRange, true, 0);
    }
    this.requestUpdate();
  }

  /**
   * The editor is a separate file next to this one, loaded only when the card
   * editor opens. It carries the same ?v= as this file, so both update together.
   */
  public static async getConfigElement(): Promise<HTMLElement> {
    if (!customElements.get('chart-explorer-card-editor')) {
      const here = new URL(import.meta.url);
      await import(/* @vite-ignore */ new URL(`./chart-explorer-card-editor.js${here.search}`, here).href);
    }
    return document.createElement('chart-explorer-card-editor');
  }

  public set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;
    this._syncLocale(hass);
    const dark = Boolean(hass.themes?.darkMode);
    if (dark !== this._dark) {
      this._dark = dark;
      this._theme = undefined;
      if (!first) this._requestDraw(true);
    }
    if (!this._config) return;
    const changed = this._statesChanged(hass);
    if (!this._window) {
      this._applySpec(this._spec ?? this._config.defaultRange, false, 0);
      return;
    }
    if (changed.length) {
      this._appendLive(hass, changed);
      // Lists read from attributes, such as forecasts, are redrawn when their entity changes.
      if (this._config.entities.some((row) => row.attribute && changed.includes(row.entity))) this._requestDraw();
      this.requestUpdate();
    }
  }

  public get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  public getCardSize(): number {
    return Math.ceil(((this._config?.height ?? 250) + 110) / 50);
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  public static getStubConfig(hass: HomeAssistant): CardConfigInput {
    const numeric = Object.values(hass.states).filter(
      (s): s is HassEntity =>
        Boolean(s?.entity_id.startsWith('sensor.') && s.attributes.unit_of_measurement) &&
        Number.isFinite(Number(s?.state)),
    );
    const temperatures = numeric.filter((s) => s.attributes.device_class === 'temperature');
    const picks = (temperatures.length >= 2 ? temperatures : numeric).slice(0, 2).map((s) => s.entity_id);
    return { type: 'custom:chart-explorer-card', entities: picks.length ? picks : ['sensor.example'] };
  }

  // ---- Lifecycle ----

  override connectedCallback(): void {
    super.connectedCallback();
    clearTimeout(this._releaseTimer);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._startMinuteTimer();
    if (this._config && this._hass && this._window && !this._data) this._scheduleLoad(0);
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._closeMenu();
    this._teardownChart();
    this._stopMinuteTimer();
    clearTimeout(this._loadTimer);
    clearTimeout(this._drawTimer);
    this._drawTimer = undefined;
    if (this._frame !== undefined) cancelAnimationFrame(this._frame);
    this._frame = undefined;
    this._requestId++;
    this._setLoading(false);
    // Free the data a minute after the card leaves the page, unless it comes back.
    this._releaseTimer = window.setTimeout(() => {
      this._data = undefined;
      this._zoomLevels = [];
      this._cache.clear();
      this._seriesMemo.clear();
      this._version++;
    }, MINUTE);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this._ensureChart();
    this._observeToolbar();
    this._checkToolbar();
    if (this._menu) this._fitMenu();
  }

  /**
   * Keeps an open menu inside the card, so a container that clips the card
   * (such as the editor preview) cannot cut it off. It keeps room for about
   * five entries and scrolls beyond that.
   */
  private _fitMenu(): void {
    const menu = this.renderRoot.querySelector<HTMLElement>('.menu, .popover');
    const card = this.renderRoot.querySelector('ha-card')?.getBoundingClientRect();
    const bar = this.renderRoot.querySelector('.toolbar')?.getBoundingClientRect();
    if (!menu || !card || !bar) return;
    const upwards = this._config?.toolbarPosition === 'bottom';
    const inCard = upwards ? bar.top - card.top : card.bottom - bar.bottom;
    const inView = upwards ? bar.top : window.innerHeight - bar.bottom;
    const room = Math.min(Math.max(inCard - 8, 220), inView - 8, 440);
    menu.style.maxHeight = `${Math.max(140, room)}px`;
  }

  private _ensureChart(): void {
    if (this._chart || !this.isConnected) return;
    const container = this.renderRoot.querySelector<HTMLElement>('.chart');
    const surface = this.renderRoot.querySelector<HTMLElement>('.chart-wrap');
    const selection = this.renderRoot.querySelector<HTMLElement>('.selection');
    if (!container || !surface || !selection) return;
    const chart = init(container, undefined, { renderer: 'canvas' });
    this._chart = chart;
    chart.on('updateAxisPointer', (event: unknown) => {
      const axes = (event as { axesInfo?: { axisDim: string; value: number }[] }).axesInfo ?? [];
      const x = axes.find((axis) => axis.axisDim === 'x');
      if (x && this._config?.chartType === 'heatmap') {
        // The cell under the pointer: its day from the x-axis, its hour from the y-axis.
        const y = axes.find((axis) => axis.axisDim === 'y');
        const cell = new Date(startOfUnit(Number(x.value), 'day', this._weekStart));
        if (y) cell.setHours(Math.min(23, Math.max(0, Math.floor(Number(y.value)))));
        this._setCursor(y ? cell.getTime() : undefined);
        return;
      }
      this._setCursor(x ? Number(x.value) : undefined);
    });
    // A slice opens the details of its entity.
    chart.on('click', (event: unknown) => {
      const { seriesId, name } = event as { seriesId?: string; name?: string };
      const config = this._config;
      if (!config || (config.chartType !== 'pie' && config.chartType !== 'donut')) return;
      const row =
        seriesId === '__numbers'
          ? config.entities.find((item) => this._view(item).name === name)
          : config.entities.find((item) => item.key === seriesId);
      if (row) this._moreInfo(row);
    });
    chart.getZr().on('globalout', () => this._setCursor(undefined));
    this._gestures = new InteractionController(surface, selection, this._gestureHost);
    this._resizeObserver = new ResizeObserver((entries) => this._onResize(entries));
    this._resizeObserver.observe(container);
    this._observeToolbar();
    this._intersection = new IntersectionObserver((entries) =>
      this._setOnScreen(entries[entries.length - 1]?.isIntersecting ?? true),
    );
    this._intersection.observe(this);
    this._chartWidth = container.clientWidth;
    this._requestDraw(true);
  }

  /** The toolbar element changes when it moves between the top and the bottom. */
  private _observeToolbar(): void {
    const toolbar = this.renderRoot.querySelector('.toolbar-wrap') ?? undefined;
    if (!this._resizeObserver || toolbar === this._observedToolbar) return;
    if (this._observedToolbar) this._resizeObserver.unobserve(this._observedToolbar);
    if (toolbar) this._resizeObserver.observe(toolbar);
    this._observedToolbar = toolbar;
  }

  private _teardownChart(): void {
    this._observedToolbar = undefined;
    this._gestures?.destroy();
    this._gestures = undefined;
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._intersection?.disconnect();
    this._intersection = undefined;
    this._chart?.dispose();
    this._chart = undefined;
  }

  // ---- Locale and live states ----

  private _syncLocale(hass: HomeAssistant): void {
    const locale = hass.locale ?? { language: hass.language ?? 'en' };
    const key = `${locale.language}|${locale.time_format}|${locale.number_format}|${locale.first_weekday}`;
    if (key === this._localeKey) return;
    this._localeKey = key;
    this._times = new TimeFormatter(locale.language, locale.time_format);
    this._numbers = new NumberFormatter(locale);
    this._stateLabels.clear();
    const weekStart = resolveWeekStart(locale.first_weekday);
    if (weekStart !== this._weekStart) {
      this._weekStart = weekStart;
      if (this._config && this._window && this._spec && followsCalendar(this._spec)) this._applySpec(this._spec, true);
    }
  }

  /** Entities whose state object changed since the last update. */
  private _statesChanged(hass: HomeAssistant): string[] {
    const changed: string[] = [];
    for (const row of this._config?.entities ?? []) {
      const state = hass.states[row.entity];
      if (this._seen.get(row.entity) !== state || !this._seen.has(row.entity)) {
        this._seen.set(row.entity, state);
        changed.push(row.entity);
      }
    }
    return changed;
  }

  /** Adds new states to the data when the window includes the present. */
  private _appendLive(hass: HomeAssistant, ids: string[]): void {
    const data = this._data;
    const w = this._window;
    if (!data || !w) return;
    const now = Date.now();
    if (w.start > now || w.end < now - MINUTE) return;
    let added = false;
    for (const id of ids) {
      const entity = data.entities.get(id);
      const state = hass.states[id];
      if (!entity || !state) continue;
      const time = Date.parse(state.last_changed);
      if (!Number.isFinite(time) || time < w.start) continue;
      if (appendPoint(entity.raw, Math.min(time, now), stateToNumber(state.state), state.state)) added = true;
    }
    for (const row of this._config?.entities ?? []) {
      if (!ids.includes(row.entity) || !row.showInChart || (!row.timeShift && !this._attributeHistory(row))) continue;
      const state = hass.states[row.entity];
      if (!state) continue;
      const shift = row.timeShift ?? 0;
      if (this._attributeHistory(row)) {
        // An attribute's change updates the state's last update, not its last change.
        const series = data.attributes?.get(attributeKey(entityKey(row), (row.attribute as NonNullable<EntityConfig['attribute']>).name));
        const time = Date.parse(state.last_updated);
        if (!series || !Number.isFinite(time)) continue;
        const value = this._attributeNow(row) / (row.multiply ?? 1);
        if (appendPoint(series, Math.min(time, now) - shift, value)) added = true;
        continue;
      }
      // A shifted row's new state is drawn its shift later (or earlier).
      const entity = data.entities.get(entityKey(row));
      const time = Date.parse(state.last_changed);
      if (!entity || !Number.isFinite(time)) continue;
      if (appendPoint(entity.raw, Math.min(time, now) - shift, stateToNumber(state.state), state.state)) added = true;
    }
    if (added) {
      this._version++;
      this._requestDraw();
    }
  }

  // ---- Choosing the window and loading data ----

  private _applySpec(spec: RangeSpec, clearZoom: boolean, delay = 300): void {
    if (!this._config) return;
    this._spec = spec;
    this._preview = undefined;
    if (clearZoom) {
      this._zoomLevels = [];
      this._gestureSpec = undefined;
    }
    this._window = resolveWindow(spec, Date.now(), this._weekStart);
    this._menu = undefined;
    this._cursor = undefined;
    this.requestUpdate();
    this._scheduleLoad(delay);
  }

  private _scheduleLoad(delay: number, force = false): void {
    clearTimeout(this._loadTimer);
    // Any reply still on its way is for a window the user has left.
    this._requestId++;
    if (!this._hass || !this._config || !this._window) return;
    const now = Date.now();
    if (!force && this._data && this._covers(this._data, this._window, now)) {
      this._setLoading(false);
      this._requestDraw(true);
      return;
    }
    this._setLoading(true);
    this._loadTimer = window.setTimeout(() => void this._load(force), delay);
  }

  /** True when loaded data already has what `w` needs. */
  private _covers(data: LoadedData, w: TimeWindow, now: number): boolean {
    const config = this._config as CardConfig;
    return canReuse(data, w, now, config.data, this._meta.rawSince(now), this._bucketPeriod(w));
  }

  /** The period of each bar, pie value or heatmap cell for a window; undefined when nothing needs them. */
  private _bucketPeriod(w: TimeWindow): BucketPeriod | undefined {
    const config = this._config;
    if (!config) return undefined;
    const rows = config.entities.filter((row) => this._usesBuckets(row));
    if (!rows.length) return undefined;
    if (config.chartType === 'heatmap') return 'hour';
    if (config.chartType === 'pie' || config.chartType === 'donut') return w.end - w.start <= 31 * DAY ? 'hour' : 'day';
    return bucketPeriodFor(w, config.period);
  }

  /** What to request for a window, for the given rows: lines, states, values per period and attribute histories. */
  private _loadInput(
    hass: HomeAssistant,
    w: TimeWindow,
    now: number,
    resolution?: Resolution,
    rows: EntityConfig[] = (this._config as CardConfig).entities.filter((row) => !row.timeShift),
  ): LoadInput {
    const config = this._config as CardConfig;
    // Entities shown only in the values row load nothing: they show their current value.
    const drawn = rows.filter((row) => row.showInChart);
    const ids = (keep: (row: EntityConfig) => boolean) => drawn.filter(keep).map((row) => row.entity);
    // A ratio needs every meter it adds up or divides by, per period.
    const bucketIds = drawn
      .filter((row) => this._usesBuckets(row))
      .flatMap((row) => [row.entity, ...(row.ratio ? [...row.ratio.add, ...row.ratio.divideBy] : [])]);
    return {
      hass,
      entityIds: this._isTimeChart() ? ids((row) => !row.attribute && !row.ratio && this._kind(row) === 'line') : [],
      textIds: ids((row) => !row.attribute && isStateKind(this._kind(row))),
      bucketIds: [...new Set(bucketIds)],
      bucketPeriod: this._bucketPeriod(w),
      weekStart: this._weekStart,
      attributeHistory: this._isTimeChart()
        ? drawn
            .filter((row) => this._attributeHistory(row))
            .map((row) => ({ id: row.entity, name: (row.attribute as NonNullable<EntityConfig['attribute']>).name }))
        : [],
      window: w,
      now,
      settings: config.data,
      meta: this._meta,
      resolution,
    };
  }

  /**
   * Loads a window: the rows as they are, and for each time shift its rows
   * over the window moved by the shift (8 hours earlier for -8h), moved back
   * onto the window shown.
   */
  private async _fetch(hass: HomeAssistant, w: TimeWindow, now: number, resolution?: Resolution, bucketPeriod?: BucketPeriod): Promise<LoadedData> {
    const config = this._config as CardConfig;
    const groups = new Map<number, EntityConfig[]>();
    for (const row of config.entities) {
      if (!row.timeShift || !row.showInChart) continue;
      groups.set(row.timeShift, [...(groups.get(row.timeShift) ?? []), row]);
    }
    const input = (window: TimeWindow, rows?: EntityConfig[]): LoadInput => {
      const base = this._loadInput(hass, window, now, resolution, rows);
      return bucketPeriod ? { ...base, bucketPeriod } : base;
    };
    const shifted = [...groups].map(async ([shift, rows]) => {
      const data = await loadWindow(input({ start: w.start + shift, end: w.end + shift }, rows));
      return { shift, data };
    });
    const [data, ...others] = await Promise.all([loadWindow(input(w)), ...shifted]);
    for (const { shift, data: other } of others) mergeShifted(data, other, shift);
    return data;
  }


  private async _load(force: boolean): Promise<void> {
    const hass = this._hass;
    const config = this._config;
    const w = this._window;
    if (!hass || !config || !w) return;
    const now = Date.now();
    const key = cacheKey(chooseResolution(w, config.data, this._meta.rawSince(now), now), w, this._bucketPeriod(w));
    const cached = force ? undefined : this._cache.get(key);
    if (cached) {
      this._setData(cached);
      return;
    }
    const id = ++this._requestId;
    try {
      const data = await this._fetch(hass, w, now);
      if (id !== this._requestId) return;
      if (w.end < now) this._cache.set(key, data);
      this._setData(data);
    } catch (err) {
      if (id !== this._requestId) return;
      this._setLoading(false);
      this._error = errorText(err);
      this.requestUpdate();
    }
  }

  /**
   * Reloads the window in the background, without the loading bar: bars, pies
   * and heatmaps include the period in progress, which live states do not update.
   */
  private _refresh(): void {
    const hass = this._hass;
    const w = this._window;
    if (!hass || !w || this._refreshing || this._loading || this._preview) return;
    const id = this._requestId;
    this._refreshing = true;
    this._fetch(hass, w, Date.now())
      .then((data) => {
        if (id !== this._requestId) return;
        this._data = data;
        this._version++;
        this.requestUpdate();
        this._requestDraw(true);
      })
      .catch(() => undefined)
      .finally(() => {
        this._refreshing = false;
      });
  }

  /**
   * Makes sure data covers `w` at the resolution it needs, loading it with a
   * margin of half a window on either side so short drags need no new request.
   * Only one such request runs at a time; when it returns, the card checks
   * again where the gesture has got to.
   */
  private _ensureCoverage(w: TimeWindow): void {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config) return;
    const now = Date.now();
    const rawSince = this._meta.rawSince(now);
    if (this._data && this._covers(this._data, w, now)) return;
    if (this._extLoad) return;
    const resolution = chooseResolution(w, config.data, rawSince, now);
    const half = (w.end - w.start) / 2;
    const window = { start: Math.round(w.start - half), end: Math.round(w.end + half) };
    const id = this._requestId;
    this._extLoad = { window, resolution };
    this._gestureLoading = true;
    this.requestUpdate();
    this._fetch(hass, window, now, resolution, this._bucketPeriod(w))
      .then((data) => {
        if (id !== this._requestId) return;
        this._data = data;
        this._version++;
        this._error = undefined;
        this._requestDraw(true);
      })
      .catch((err) => {
        if (id === this._requestId && !this._preview) this._error = errorText(err);
      })
      .finally(() => {
        this._extLoad = undefined;
        this._gestureLoading = false;
        this.requestUpdate();
        const current = this._preview ?? this._window;
        if (id === this._requestId && current) this._ensureCoverage(current);
      });
  }

  private _requestFrame(): void {
    if (this._frame !== undefined) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = undefined;
      this._draw();
    });
  }

  private _setData(data: LoadedData): void {
    this._data = data;
    this._version++;
    this._error = undefined;
    this._setLoading(false);
    this.requestUpdate();
    this._requestDraw(true);
  }

  private _setLoading(on: boolean): void {
    if (on === this._loading) return;
    this._loading = on;
    this._slow = false;
    clearTimeout(this._slowTimer);
    if (on) {
      this._slowTimer = window.setTimeout(() => {
        this._slow = true;
        this.requestUpdate();
      }, 3000);
    }
    this.requestUpdate();
  }

  private _retry = (): void => {
    this._error = undefined;
    this._scheduleLoad(0, true);
  };

  // ---- Toolbar actions ----

  private _isActive(item: RangeItem): boolean {
    return rangeItemActive(item, this._spec);
  }

  private _step(direction: 1 | -1): void {
    if (this._spec) this._applySpec(stepSpec(this._spec, direction, Date.now(), this._weekStart), true);
  }

  private _goNow = (): void => {
    if (this._spec) this._applySpec(nowSpec(this._spec), true);
  };

  private _applyCustom = (): void => {
    const from = fromDatetimeLocal(this._inputValue('#from'));
    const to = fromDatetimeLocal(this._inputValue('#to'));
    if (from === undefined || to === undefined || from >= to) {
      this._customError = t('invalid_range');
      this.requestUpdate();
      return;
    }
    this._customError = undefined;
    this._applySpec({ kind: 'fixed', start: from, end: to }, true, 0);
  };

  private _inputValue(selector: string): string {
    return this.renderRoot.querySelector<HTMLInputElement>(selector)?.value ?? '';
  }

  private _toggleMenu(menu: Menu): void {
    const next = this._menu === menu ? undefined : menu;
    if (next === 'custom' && this._window) {
      this._customFrom = toDatetimeLocal(this._window.start);
      this._customTo = toDatetimeLocal(this._window.end);
      this._customError = undefined;
    }
    this._menu = next;
    if (next) {
      document.addEventListener('pointerdown', this._onOutsidePointer, true);
      document.addEventListener('keydown', this._onKey, true);
    } else {
      this._removeMenuListeners();
    }
    this.requestUpdate();
  }

  private _closeMenu(): void {
    this._removeMenuListeners();
    if (this._menu) {
      this._menu = undefined;
      this.requestUpdate();
    }
  }

  private _removeMenuListeners(): void {
    document.removeEventListener('pointerdown', this._onOutsidePointer, true);
    document.removeEventListener('keydown', this._onKey, true);
  }

  private _onOutsidePointer = (event: PointerEvent): void => {
    const wrap = this.renderRoot.querySelector('.toolbar-wrap');
    if (wrap && !event.composedPath().includes(wrap)) this._closeMenu();
  };

  private _onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this._closeMenu();
  };

  private readonly _gestureHost: InteractionHost = {
    chart: () => this._chart,
    axis: () => {
      const w = this._preview ?? this._window;
      return w ? this._axisFor(w) : undefined;
    },
    window: () => this._preview ?? this._window,
    enabled: () =>
      Boolean(this._data) && !this._menu && this._config?.chartType !== 'pie' && this._config?.chartType !== 'donut',
    dragAction: () => this._config?.dragAction ?? 'pan',
    preview: (w) => {
      // Redrawn every frame from the data on hand; data for parts not loaded yet
      // is fetched while the gesture goes on.
      this._preview = w;
      this._requestFrame();
      this._ensureCoverage(w);
      this.requestUpdate();
    },
    commit: (w) => {
      this._preview = undefined;
      if (!this._spec) return;
      // A run of gestures keeps one way back: to the window picked before them.
      if (this._spec !== this._gestureSpec) {
        this._zoomLevels.push({ spec: this._spec, data: this._data });
        if (this._zoomLevels.length > MAX_ZOOM_LEVELS) this._zoomLevels.shift();
      }
      this._spec = { kind: 'fixed', start: w.start, end: w.end };
      this._gestureSpec = this._spec;
      this._window = w;
      this._cursor = undefined;
      this.requestUpdate();
      this._requestDraw(true);
      this._ensureCoverage(w);
    },
    back: () => {
      const level = this._zoomLevels.pop();
      if (!level) return;
      const restored = level.data && level.data !== this._data;
      if (level.data) {
        this._data = level.data;
        this._version++;
      }
      this._applySpec(level.spec, false, 0);
      // Live data kept from before the zoom missed the states that came in since.
      if (restored && slides(level.spec)) this._scheduleLoad(0, true);
    },
  };

  // ---- Values row ----

  private _view(row: EntityConfig): RowView {
    const state = this._hass?.states[row.entity];
    const palette = seriesColor(row.index, this._dark);
    return {
      row,
      name: row.name ?? state?.attributes.friendly_name ?? row.entity,
      // An entity's second and later values start from its colour, moved towards grey.
      color: row.color ?? (row.shade ? shadeColor(row.baseColor ?? palette.color, row.shade) : palette.color),
      dashed: row.color || row.shade !== undefined ? false : palette.dashed,
      // A list from an attribute has no unit of its own; the entity's unit belongs to its state.
      // A single-number attribute, such as a rate's threshold, is taken to share the entity's unit.
      unit: row.ratio
        ? (row.unit ?? this._ratio(row)?.unit ?? '')
        : this._attributeHistory(row)
        ? (row.unit ?? String(state?.attributes.unit_of_measurement ?? ''))
        : row.attribute
        ? (row.unit ?? suggestedListUnit(state?.attributes.unit_of_measurement, state?.attributes[row.attribute.name]))
        : row.unit ??
        state?.attributes.unit_of_measurement ??
        this._data?.entities.get(entityKey(row))?.statisticsUnit ??
        this._data?.buckets?.entities.get(entityKey(row))?.unit ??
        '',
      decimals: row.ratio
        ? (row.decimals ?? 2)
        : row.attribute || row.multiply !== undefined
        ? row.decimals
        : (row.decimals ??
          this._hass?.entities?.[row.entity]?.display_precision ??
          (state ? decimalsOf(state.state) : undefined)),
    };
  }

  private _series(row: EntityConfig): Series {
    if (this._attributeList(row)) return this._attribute(row);
    if (!this._data) return { t: [], v: [] };
    const memo = this._seriesMemo.get(row.key);
    if (memo && memo.version === this._version) return memo.series;
    let series = row.attribute
      ? (this._data.attributes?.get(attributeKey(entityKey(row), row.attribute.name)) ?? { t: [], v: [] })
      : seriesFor(row, this._data, this._config?.statistic);
    if (row.multiply !== undefined) series = { ...series, v: scaled(series.v, row.multiply) };
    this._seriesMemo.set(row.key, { version: this._version, series });
    return series;
  }

  /**
   * Whether a row draws its attribute's recorded history: an attribute named
   * without values, holding a single number rather than a list (a threshold).
   */
  private _attributeHistory(row: EntityConfig): boolean {
    if (!row.attribute || row.attribute.value !== undefined) return false;
    return !isListValue(this._hass?.states[row.entity]?.attributes[row.attribute.name]);
  }

  /** A list row: values read from a list in the attribute, drawn as the list is now. */
  private _attributeList(row: EntityConfig): boolean {
    return Boolean(row.attribute) && !this._attributeHistory(row);
  }

  /** The attribute's current value as a number, for the values row. */
  private _attributeNow(row: EntityConfig): number {
    const raw = this._hass?.states[row.entity]?.attributes[(row.attribute as NonNullable<EntityConfig['attribute']>).name];
    return (typeof raw === 'number' ? raw : stateToNumber(raw === undefined || raw === null ? '' : String(raw))) * (row.multiply ?? 1);
  }

  /** The latest moment a row has values for: now, moved by its time shift (8 hours ahead for -8h). */
  private _latest(row: EntityConfig, now = Date.now()): number {
    return now - (row.timeShift ?? 0);
  }

  /**
   * A value from the list in a row's attribute (its own, or `key` for the value
   * its fill reaches up to), read again only when the attribute changes.
   */
  private _attribute(row: EntityConfig, key = row.attribute?.value): AttributeSeries {
    const source = row.attribute as NonNullable<EntityConfig['attribute']>;
    const raw = this._hass?.states[row.entity]?.attributes[source.name];
    const memoKey = `${row.key}|${key ?? ''}`;
    const memo = this._attributeMemo.get(memoKey);
    if (memo && memo.raw === raw) return memo.series;
    const list = attributeSeries(raw, { ...source, value: key });
    const shift = row.timeShift ?? 0;
    const series = {
      t: shift ? list.t.map((time) => time - shift) : list.t,
      v: row.multiply === undefined ? list.v : scaled(list.v, row.multiply),
    };
    this._attributeMemo.set(memoKey, { raw, series });
    return series;
  }

  // ---- How rows are drawn ----

  private _kind(row: EntityConfig): RowKind {
    const known = this._kinds.get(row.key);
    if (known) return known;
    if (row.attribute) return 'line';
    // A ratio is a bar per period, or in a line chart the ratio so far.
    if (row.ratio) {
      if (row.type === 'line' || row.type === 'bar') return row.type;
      return this._config?.chartType === 'bar' ? 'bar' : 'line';
    }
    // A sensor that is unavailable or unknown right now is judged by its loaded history.
    const state = this._hass?.states[row.entity];
    const recorded = this._data?.entities.get(row.entity)?.raw.s;
    const kind = rowKind(row.type, this._config?.chartType ?? 'line', state, recorded);
    if (this._hass && kindSettled(row.type, state, recorded)) this._kinds.set(row.key, kind);
    return kind;
  }

  /** Lines, stacked areas and bars share a time axis with the timeline strips; pies and heatmaps do not. */
  private _isTimeChart(): boolean {
    const type = this._config?.chartType;
    return type === 'line' || type === 'area' || type === 'bar';
  }

  /** Rows drawn from values per period: bars, and every number in a pie or heatmap. */
  private _usesBuckets(row: EntityConfig): boolean {
    if (row.attribute) return false;
    // Ratios are drawn on a time axis only: pies and heatmaps leave them out.
    if (row.ratio) return this._isTimeChart();
    const kind = this._kind(row);
    return this._isTimeChart() ? kind === 'bar' : !isStateKind(kind);
  }

  private _buckets(row: EntityConfig): RowBuckets | undefined {
    if (row.ratio) return this._ratioBuckets(row);
    const entry = this._data?.buckets?.entities.get(entityKey(row));
    if (!entry) return undefined;
    const memo = this._bucketMemo.get(row.key);
    if (memo && memo.version === this._version) return memo.buckets;
    const { buckets, meanType } = entry;
    const v = scaled(bucketValues(buckets, meanType, row.statistic ?? this._config?.statistic), row.multiply);
    const result = { t: buckets.t, end: buckets.end, v, meanType };
    this._bucketMemo.set(row.key, { version: this._version, buckets: result });
    return result;
  }

  /** A ratio row's periods: its meters' rises and their ratio, worked out again when the data changes. */
  private _ratio(row: EntityConfig): RatioPeriods | undefined {
    const data = this._data?.buckets;
    const source = row.ratio;
    if (!data || !source) return undefined;
    const memo = this._ratioMemo.get(row.key);
    if (memo && memo.version === this._version) return memo.ratio;
    const part = (id: string): RatioPart => {
      const entry = data.entities.get(id);
      const state = this._hass?.states[id];
      const stateClass = state?.attributes.state_class;
      return {
        id,
        change: entry?.buckets.change ?? [],
        unit: entry?.unit ?? String(state?.attributes.unit_of_measurement ?? ''),
        // A meter has a running total: statistics with a sum, or a total state class.
        meter: entry ? !entry.meanType || stateClass === 'total' || stateClass === 'total_increasing' : false,
        found: Boolean(state),
      };
    };
    const first = data.entities.get(row.entity)?.buckets ?? { t: [], end: [] };
    const ratio = ratioPeriods(
      first.t,
      first.end,
      [row.entity, ...source.add].map(part),
      source.divideBy.map(part),
      source.minDivisor,
    );
    this._ratioMemo.set(row.key, { version: this._version, ratio });
    return ratio;
  }

  /** The values a ratio row draws per period: each period's ratio for bars, the ratio so far for a line. */
  private _ratioBuckets(row: EntityConfig): RowBuckets | undefined {
    const ratio = this._ratio(row);
    const w = this._window;
    if (!ratio || !w) return undefined;
    const v = this._kind(row) === 'line' ? runningRatio(ratio, w.start, Math.min(w.end, Date.now())) : ratio.v;
    return { t: ratio.t, end: ratio.end, v: scaled(v, row.multiply), meanType: true };
  }

  /** Why a ratio row cannot be drawn, naming the meter: missing, or a measurement rather than a meter. */
  private _ratioProblem(row: EntityConfig): string | undefined {
    const problem = this._ratio(row)?.problem;
    if (!problem) return undefined;
    return problem.reason === 'not_found'
      ? `${problem.id} was not found.`
      : `${problem.id} is a measurement, not a meter: a ratio needs meters with a running total, such as kWh.`;
  }

  /** A state as Home Assistant shows it, such as "Standby" or "Open". */
  private _stateLabel(row: EntityConfig, state: string): string {
    const key = `${row.entity}|${state}`;
    let label = this._stateLabels.get(key);
    if (label === undefined) {
      const stateObj = this._hass?.states[row.entity];
      label = stateObj && this._hass?.formatEntityState ? this._hass.formatEntityState(stateObj, state) : state;
      this._stateLabels.set(key, label);
    }
    return label;
  }

  private _stateColor(row: EntityConfig, state: string): string | undefined {
    const theme = (this._theme ??= readTheme(this, this._dark));
    const options = this._hass?.states[row.entity]?.attributes.options;
    return stateColor(state, {
      overrides: row.stateColors,
      entityColor: this._view(row).color,
      neutral: withAlpha(theme.secondaryText, theme.dark ? 0.35 : 0.3),
      dark: this._dark,
      options: Array.isArray(options) ? options.map(String) : undefined,
    });
  }

  /** The values row writes quiet and missing states in grey, others in their colour; a colour set for a state wins. */
  private _stateTextColor(row: EntityConfig, state: string): string {
    if (row.stateColors[state]) return row.stateColors[state];
    if (isMissingState(state) || isQuietState(state)) return 'var(--secondary-text-color)';
    return this._stateColor(row, state) ?? 'var(--secondary-text-color)';
  }

  /** Each number's share of the pie: totals for meters, averages (or lowest or highest) for the rest. */
  private _pieRows(): PieRow[] {
    const config = this._config;
    const w = this._window;
    if (!config || !w) return [];
    const until = Math.min(w.end, Date.now());
    const rows: PieRow[] = [];
    for (const row of config.entities) {
      if (isStateKind(this._kind(row)) || row.ratio || !row.showInChart || this._faded.has(row.key)) continue;
      const buckets = this._buckets(row);
      if (!buckets) continue;
      const value = windowValue(buckets, w.start, until, row.statistic ?? config.statistic);
      if (value > 0) rows.push({ row, value, drawn: value, share: 0 });
    }
    // A charger in kW beside sensors in W: compare them in one unit.
    const drawn = inCommonUnits(rows.map((item) => ({ value: item.value, unit: this._view(item.row).unit })));
    rows.forEach((item, i) => (item.drawn = drawn[i]));
    const total = rows.reduce((sum, item) => sum + item.drawn, 0);
    for (const item of rows) item.share = (item.drawn / total) * 100;
    return rows;
  }

  private _reading(view: RowView): Reading {
    const { row } = view;
    const kind = this._kind(row);
    // With the floating tooltip on, it follows the cursor and the row keeps the current values.
    // An entity shown only in the values row keeps its current value too.
    const cursor = this._data && !this._config?.tooltip && row.showInChart ? this._cursor : undefined;
    // Nothing is recorded after the present, or for a shifted row after the present moved by its shift.
    const future = cursor !== undefined && cursor > this._latest(row);
    if (isStateKind(kind)) {
      // A shifted row shows what is drawn at the present: the state from its shift ago.
      const at = cursor ?? (row.timeShift ? Date.now() : undefined);
      if (at !== undefined) {
        if (cursor !== undefined && this._isHeatStates(row)) return this._heatHourReading(row, cursor);
        const state = future ? undefined : stateAt(this._series(row), at);
        if (state === undefined) return { text: '-', numeric: false };
        return { text: this._stateLabel(row, state), numeric: false, color: this._stateTextColor(row, state) };
      }
      const state = this._hass?.states[row.entity];
      if (!state) return { text: 'n/a', numeric: false, title: t('not_found') };
      return {
        text: this._stateLabel(row, state.state),
        numeric: false,
        title: this._title(row),
        color: this._stateTextColor(row, state.state),
      };
    }
    if (row.ratio) {
      const problem = this._ratioProblem(row);
      if (problem) return { text: 'n/a', numeric: false, title: problem };
      const buckets = this._buckets(row);
      if (cursor !== undefined) return this._numberReading(view, buckets ? bucketAt(buckets, cursor) : NaN);
      // The whole window: the sum of one side's rises over the sum of the other's.
      const ratio = this._ratio(row);
      const w = this._window;
      const value = ratio && w ? windowRatio(ratio, w.start, Math.min(w.end, Date.now())) * (row.multiply ?? 1) : NaN;
      return { ...this._numberReading(view, value), title: t('ratio_shown') };
    }
    if (this._attributeHistory(row)) {
      // A single-number attribute: its value now, or its recorded value at the cursor.
      if (cursor !== undefined) return this._numberReading(view, future ? NaN : valueAt(this._series(row), cursor));
      return { ...this._numberReading(view, this._attributeNow(row)), title: this._title(row) };
    }
    if (row.attribute) {
      // A forecast has values after the present: the row shows the one now, or at the cursor.
      const reading = this._numberReading(view, valueAt(this._attribute(row), cursor ?? Date.now()));
      return cursor === undefined ? { ...reading, title: this._title(row) } : reading;
    }
    if (this._usesBuckets(row)) {
      const buckets = this._buckets(row);
      if (cursor !== undefined) return this._numberReading(view, buckets ? bucketAt(buckets, cursor) : NaN);
      const type = this._config?.chartType;
      if (type === 'pie' || type === 'donut') {
        const slice = this._pieRows().find((item) => item.row.key === row.key);
        if (!slice) return { text: '-', numeric: false, title: this._title(row) };
        const reading = this._numberReading(view, slice.value);
        const share = `${this._numbers.format(slice.share, 0)} %`;
        return { ...reading, unit: reading.unit ? `${reading.unit} · ${share}` : share, title: this._title(row) };
      }
      // A meter's bars add up: the row shows the total of the bars on screen.
      if (buckets && !buckets.meanType) {
        const total = buckets.v.reduce((sum, value) => (Number.isFinite(value) ? sum + value : sum), 0);
        return { ...this._numberReading(view, total), title: t('total_shown') };
      }
    }
    if (cursor !== undefined) return this._numberReading(view, future ? NaN : valueAt(this._series(row), cursor));
    // A shifted row shows what is drawn at the present: the value from its shift ago.
    if (row.timeShift && row.showInChart) return { ...this._numberReading(view, valueAt(this._series(row), Date.now())), title: this._title(row) };
    const state = this._hass?.states[row.entity];
    if (!state) return { text: 'n/a', numeric: false, title: t('not_found') };
    const title = this._title(row);
    const value = stateToNumber(state.state) * (row.multiply ?? 1);
    if (Number.isNaN(value)) {
      return { text: this._hass?.formatEntityState?.(state) ?? state.state, numeric: false, title };
    }
    return { ...this._numberReading(view, value), title };
  }

  private _numberReading(view: RowView, value: number): Reading {
    if (!Number.isFinite(value)) return { text: '-', numeric: false };
    return {
      text: this._numbers.format(value, view.decimals),
      unit: view.row.showUnit ? view.unit : undefined,
      numeric: true,
    };
  }

  /** Hover text for a value: why it is missing, or that a tap opens more-info. */
  private _title(row: EntityConfig): string {
    const ratioProblem = row.ratio && this._ratioProblem(row);
    if (ratioProblem) return ratioProblem;
    const problem = this._data?.entities.get(row.entity)?.error as StringKey | undefined;
    return problem ? t(problem) : t('more_info');
  }

  private _moreInfo(row: EntityConfig): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', { detail: { entityId: row.entity }, bubbles: true, composed: true }),
    );
  }

  private _toggleFade(row: EntityConfig): void {
    if (this._faded.has(row.key)) this._faded.delete(row.key);
    else this._faded.add(row.key);
    this.requestUpdate();
    this._requestDraw(true);
  }

  private _setCursor(time: number | undefined): void {
    if (time === this._cursor) return;
    this._cursor = time;
    if (this._cursorFrame !== undefined) return;
    this._cursorFrame = requestAnimationFrame(() => {
      this._cursorFrame = undefined;
      this.requestUpdate();
    });
  }

  // ---- Drawing ----

  private _canDraw(): boolean {
    return this._onScreen && document.visibilityState === 'visible' && this.isConnected;
  }

  private _requestDraw(immediate = false): void {
    this._dirty = true;
    if (!this._chart || !this._canDraw()) return;
    if (immediate) {
      clearTimeout(this._drawTimer);
      this._drawTimer = undefined;
      this._draw();
      return;
    }
    if (this._drawTimer !== undefined) return;
    const interval = this._config?.lightweight ? 10_000 : 1_000;
    const wait = Math.max(0, this._lastDraw + interval - Date.now());
    this._drawTimer = window.setTimeout(() => {
      this._drawTimer = undefined;
      this._draw();
    }, wait);
  }

  private _draw(): void {
    const chart = this._chart;
    const config = this._config;
    const w = this._preview ?? this._window;
    if (!chart || !config || !w) return;
    this._dirty = false;
    this._lastDraw = Date.now();
    const theme = (this._theme ??= readTheme(this, this._dark));
    if (config.chartType === 'pie' || config.chartType === 'donut') {
      this._drawPie(chart, config, theme);
      return;
    }
    if (config.chartType === 'heatmap') {
      chart.setOption(this._heatmapOption(chart, config, w, theme), { notMerge: true });
      this._setOverlays([], []);
      return;
    }
    const input = this._plotInput(chart, config, w, theme);
    chart.setOption(buildOption(input), { notMerge: true });
    if (input.timeline && input.hasMain) this._alignStrips(chart, input);
    this._placeUnits(chart, config, input);
  }

  /**
   * Lines the timeline strips up with the plot above. The plot's edges depend
   * on how wide the value labels are, known only after ECharts lays it out, so
   * the strips move once more when the labels change width.
   */
  private _alignStrips(chart: EChartsType, input: PlotInput): void {
    const left = Number(chart.convertToPixel({ xAxisIndex: 0 }, input.axisStart));
    const right = Number(chart.convertToPixel({ xAxisIndex: 0 }, input.axisEnd));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return;
    const inset = { left: Math.round(left), right: Math.round(chart.getWidth() - right) };
    const used = input.timeline?.inset;
    if (used && used.left === inset.left && used.right === inset.right) return;
    this._inset = inset;
    chart.setOption({ grid: [{}, inset] });
  }

  private _setOverlays(units: { text: string; x: number }[], pies: { text: string; x: number }[]): void {
    if (JSON.stringify(units) === JSON.stringify(this._unitLabels) && JSON.stringify(pies) === JSON.stringify(this._pieNames)) {
      return;
    }
    this._unitLabels = units;
    this._pieNames = pies;
    this.requestUpdate();
  }

  /**
   * Centres each scale's unit above its column of numbers. The grid is laid out
   * so the widest number starts at the card's inner edge, which gives the
   * column's width without reading ECharts' internals.
   */
  private _placeUnits(chart: EChartsType, config: CardConfig, input: PlotInput): void {
    const labels: { text: string; x: number }[] = [];
    if (config.yAxis.units && config.yAxis.show && input.hasMain) {
      const left = Number(chart.convertToPixel({ xAxisIndex: 0 }, input.axisStart));
      const right = Number(chart.convertToPixel({ xAxisIndex: 0 }, input.axisEnd));
      const width = chart.getWidth();
      for (const axis of input.axes) {
        if (!axis.show || !axis.unit || !Number.isFinite(left) || !Number.isFinite(right)) continue;
        const x =
          axis.position === 'left'
            ? (GRID_EDGE + left - LABEL_MARGIN) / 2
            : (right + LABEL_MARGIN + width - GRID_EDGE) / 2;
        labels.push({ text: axis.unit, x: Math.round(x) });
      }
    }
    this._setOverlays(labels, []);
  }

  private _plotInput(chart: EChartsType, config: CardConfig, w: TimeWindow, theme: Theme): PlotInput {
    const now = Date.now();
    const width = chart.getWidth() || this._chartWidth || 600;
    const columns = Math.max(60, Math.round(width));
    const { axes, axisOf, factorOf } = this._axes(config);
    const axis = this._axisFor(w);
    const extendTo = Math.min(w.end, now);
    const pixel = (w.end - w.start) / columns;
    // Entities shown only in the values row are not drawn.
    const drawn = config.entities.filter((row) => row.showInChart);
    const kinds = drawn.map((row) => this._kind(row));
    const lineRows = drawn.filter((_, i) => kinds[i] === 'line');
    const stacked = config.chartType === 'area';

    let series: PlotSeries[] = lineRows.map((row) => {
      const view = this._view(row);
      let data: { t: number[]; v: number[] } = { t: [], v: [] };
      let band: PlotSeries['band'];
      if (row.ratio) {
        // The ratio so far, drawn at the end of each period (or at the present, for the one in progress).
        const buckets = this._ratioBuckets(row);
        const until = Date.now();
        if (buckets) data = { t: buckets.end.map((end) => Math.min(end, until)), v: buckets.v };
      } else if (this._attributeList(row)) {
        // A list from an attribute is drawn as it is, into the future, without thinning or holding.
        const list = sliceSeries(this._attribute(row), w.start, w.end);
        data = { t: list.t, v: list.v };
        if (row.fillTo && !stacked) {
          // The same list gives the same times, so the two values pair up point by point.
          const other = sliceSeries(this._attribute(row, row.fillTo), w.start, w.end);
          band = { low: other.v, high: list.v, opacity: row.fillOpacity ?? 0.18 };
        }
      } else if (this._data && !stacked) {
        data = decimate(this._series(row), w.start, w.end, columns);
        if (row.curve !== 'step') data = holdValues(data, 2 * pixel, rawFrom(row, this._data));
      }
      // History reaches the present; a shifted row reaches the present moved by its shift.
      if (!stacked && !this._attributeList(row) && !row.ratio) extendLastValue(data, Math.min(w.end, this._latest(row, now)));
      const axisIndex = axisOf.get(row.key) ?? 0;
      return {
        key: row.key,
        name: view.name,
        color: view.color,
        curve: row.curve,
        lineStyle: row.lineStyle ?? (view.dashed ? 'dashed' : 'solid'),
        fill: row.fill,
        fillOpacity: row.fillOpacity,
        width: row.width,
        faded: this._faded.has(row.key),
        axisIndex,
        data,
        band,
        // Ratios cannot be added up, so they never join a stack.
        stack: stacked && !row.ratio ? `stack-${axisIndex}` : undefined,
      };
    });
    if (stacked && this._data) {
      const members = lineRows.filter((row) => !row.ratio);
      const aligned = this._alignStack(
        series.filter((line) => members.some((row) => row.key === line.key)),
        members,
        w,
        columns,
        extendTo,
      );
      series = series.map((line) => aligned.find((item) => item.key === line.key) ?? line);
    }
    // Rows in W on a kW scale (and the like) are drawn converted.
    series = series.map((line) => {
      const factor = factorOf.get(line.key) ?? 1;
      if (factor === 1) return line;
      const scale = (values: number[]) => values.map((value) => value * factor);
      return {
        ...line,
        data: { t: line.data.t, v: scale(line.data.v) },
        band: line.band && { ...line.band, low: scale(line.band.low), high: scale(line.band.high) },
      };
    });

    const barRows = drawn.filter((_, i) => kinds[i] === 'bar');
    const placed = placeBars(
      barRows.map((row) => {
        const buckets = this._buckets(row) ?? { t: [], end: [], v: [] };
        const factor = factorOf.get(row.key) ?? 1;
        return factor === 1 ? buckets : { ...buckets, v: buckets.v.map((value) => value * factor) };
      }),
      config.stacked ? barRows.map((row) => !row.ratio) : false,
    );
    const bars: PlotBar[] = barRows.map((row, k) => ({
      key: row.key,
      color: this._view(row).color,
      faded: this._faded.has(row.key),
      axisIndex: axisOf.get(row.key) ?? 0,
      bars: placed[k],
    }));

    const until = Math.min(axis.end, now);
    const bands: PlotBand[] = drawn
      .filter((_, i) => kinds[i] === 'band')
      .map((row) => ({
        key: row.key,
        color: this._view(row).color,
        faded: this._faded.has(row.key),
        spans: this._data
          ? timelineSegments(this._series(row), axis.start, until, pixel).filter((segment) => isOnState(row, segment.state))
          : [],
      }));

    const stripRows = drawn.filter((_, i) => kinds[i] === 'timeline');
    const strips: PlotTimelineRow[] = stripRows.map((row) => ({
      key: row.key,
      name: this._view(row).name,
      faded: this._faded.has(row.key),
      segments: this._data
        ? timelineSegments(this._series(row), axis.start, until, pixel).map((segment) => ({
            ...segment,
            color: this._stateColor(row, segment.state),
            label: this._stateLabel(row, segment.state),
          }))
        : [],
    }));

    const length = w.end - w.start;
    const dateOnly = this._data?.resolution === 'day' || this._data?.resolution === 'week';
    return {
      window: w,
      axisStart: axis.start,
      axisEnd: axis.end,
      yPadding: config.yPadding,
      now,
      series,
      bars,
      bands,
      timeline: strips.length
        ? { rows: strips, rowHeight: config.timeline.rowHeight, names: config.timeline.names, labels: config.timeline.labels, inset: this._inset }
        : undefined,
      hasMain: kinds.some((kind) => kind !== 'timeline'),
      axes,
      theme,
      fadedOpacity: config.fadedOpacity,
      fadeRescale: config.fadeRescale,
      animation: config.animation && !this._preview,
      showNowLine: config.showNowLine,
      xAxis: config.xAxis,
      yAxis: config.yAxis,
      splitNumber: Math.max(2, Math.round(width / 110)),
      axisTime: (ms) => this._times.axisLabel(ms, length),
      cursorTime: (ms) => this._times.cursorLabel(ms, length, dateOnly),
      axisNumber: (value) => this._numbers.compact(value),
    };
  }

  /**
   * Stacked areas need every line to have a point at the same times. Each
   * line's held value is read at the union of their (thinned) timestamps, with
   * an extra time just before each long pause so a held value stays flat.
   */
  private _alignStack(
    series: PlotSeries[],
    rows: EntityConfig[],
    w: TimeWindow,
    columns: number,
    until: number,
  ): PlotSeries[] {
    const pixel = (w.end - w.start) / columns;
    const sources = rows.map((row) => this._series(row));
    const times = new Set<number>();
    for (const source of sources) for (const time of decimate(source, w.start, w.end, columns).t) times.add(time);
    if (until > w.start) times.add(until);
    const sorted = [...times].sort((a, b) => a - b);
    const union: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 2 * pixel) union.push(sorted[i] - pixel);
      union.push(sorted[i]);
    }
    return series.map((line, k) => {
      const v = union.map((time) => {
        if (time > until && !rows[k].attribute) return NaN;
        const value = valueAt(sources[k], time);
        return Number.isNaN(value) ? 0 : value;
      });
      return { ...line, data: { t: union, v } };
    });
  }

  /** The heatmap shows the first entity that is not faded, hour by hour. */
  private _heatRow(): EntityConfig | undefined {
    const rows = (this._config?.entities ?? []).filter((row) => !row.attribute && !row.ratio && row.showInChart);
    return rows.find((row) => !this._faded.has(row.key)) ?? rows[0];
  }

  /** The entity with states the heatmap shows, if it shows one. */
  private _isHeatStates(row: EntityConfig): boolean {
    return this._config?.chartType === 'heatmap' && this._heatRow()?.key === row.key && isStateKind(this._kind(row));
  }

  private _heatCells(): HeatCell[] {
    const row = this._heatRow();
    if (row && isStateKind(this._kind(row))) return this._stateHeat(row).cells;
    const buckets = row ? this._buckets(row) : undefined;
    if (!buckets) return [];
    const cells: HeatCell[] = [];
    buckets.t.forEach((start, i) => {
      const value = buckets.v[i];
      if (!Number.isFinite(value)) return;
      const day = startOfUnit(start, 'day', this._weekStart);
      cells.push({ day, dayEnd: addUnits(day, 'day', 1), hour: new Date(start).getHours(), value });
    });
    return cells;
  }

  /** Each hour of an entity with states, in the colour of the state that held longest in it. */
  private _stateHeat(row: EntityConfig): StateHeat {
    const w = this._preview ?? this._window;
    const now = Date.now();
    // The hour in progress grows, so the cells are worked out again each minute.
    const key = `${this._version}|${row.key}|${w?.start}|${w?.end}|${Math.floor(now / MINUTE)}|${this._dark}`;
    if (this._stateHeatMemo?.key === key) return this._stateHeatMemo;
    const heat: StateHeat = { key, periods: [], cells: [], states: [] };
    const until = w ? Math.min(w.end, now) : 0;
    if (w && until > w.start) {
      heat.periods = periodStates(this._series(row), periodEdges(w.start, until, 'hour', this._weekStart), until);
      const hours = new Map<string, number>();
      for (const period of heat.periods) {
        const state = mainState(period.durations);
        if (state === undefined) continue;
        hours.set(state, (hours.get(state) ?? 0) + 1);
        const day = startOfUnit(period.start, 'day', this._weekStart);
        heat.cells.push({
          day,
          dayEnd: addUnits(day, 'day', 1),
          hour: new Date(period.start).getHours(),
          value: period.durations.get(state) ?? 0,
          state,
          color: this._stateColor(row, state),
        });
      }
      heat.states = [...hours].sort((a, b) => b[1] - a[1]).map(([state]) => state);
    }
    this._stateHeatMemo = heat;
    return heat;
  }

  /** The hour containing `time` on a heatmap of states, with the state that held longest in it. */
  private _heatHour(row: EntityConfig, time: number): { period?: PeriodStates; state?: string } {
    const period = this._stateHeat(row).periods.find((item) => time >= item.start && time < item.end);
    return { period, state: period && mainState(period.durations) };
  }

  /** The hour under the cursor on a heatmap of states: the state that held longest, then the time in each state. */
  private _heatHourReading(row: EntityConfig, time: number): Reading {
    const { period, state } = this._heatHour(row, time);
    if (!period || state === undefined) return { text: '-', numeric: false };
    const parts = [...period.durations]
      .sort((a, b) => b[1] - a[1])
      .map(([item, ms], i) => (i === 0 ? this._minutes(ms) : `${this._stateLabel(row, item)} ${this._minutes(ms)}`));
    return { text: this._stateLabel(row, state), unit: parts.join(' · '), numeric: false, color: this._stateTextColor(row, state) };
  }

  private _minutes(ms: number): string {
    return ms < MINUTE ? '<1 min' : `${this._numbers.format(Math.round(ms / MINUTE), 0)} min`;
  }

  /** The states of a heatmap of states, for its colour key. */
  private _heatKey(): HeatKeyItem[] | undefined {
    if (this._config?.chartType !== 'heatmap') return undefined;
    const row = this._heatRow();
    if (!row || !isStateKind(this._kind(row))) return undefined;
    const { states } = this._stateHeat(row);
    if (!states.length) return undefined;
    return states.map((state) => ({ label: this._stateLabel(row, state), color: this._stateColor(row, state) }));
  }

  private _heatmapOption(chart: EChartsType, config: CardConfig, w: TimeWindow, theme: Theme): Record<string, unknown> {
    const row = this._heatRow();
    const width = chart.getWidth() || this._chartWidth || 600;
    const axis = this._axisFor(w);
    const length = w.end - w.start;
    return buildHeatmapOption({
      cells: this._heatCells(),
      color: row ? this._view(row).color : theme.primary,
      theme,
      axisStart: axis.start,
      axisEnd: axis.end,
      splitNumber: Math.max(2, Math.round(width / 110)),
      xAxis: config.xAxis,
      yAxis: config.yAxis,
      animation: config.animation && !this._preview,
      axisTime: (ms) => this._times.axisLabel(ms, length),
      cursorTime: (ms) => this._times.cursorLabel(ms, length, true),
      hourLabel: (hour) => this._times.hourLabel(hour),
    });
  }

  /** One pie for the numbers' totals, and one per entity with states showing the time in each state. */
  private _pies(config: CardConfig): { pies: PlotPie[]; names: string[] } {
    const pies: PlotPie[] = [];
    const names: string[] = [];
    const numbers = this._pieRows();
    if (numbers.length) {
      pies.push({
        key: '__numbers',
        named: false,
        slices: numbers.map((item) => ({ name: this._view(item.row).name, value: item.drawn, color: this._view(item.row).color })),
      });
      names.push('');
    }
    const w = this._window;
    if (!w || !this._data) return { pies, names };
    const until = Math.min(w.end, Date.now());
    for (const row of config.entities) {
      if (!isStateKind(this._kind(row)) || !row.showInChart || this._faded.has(row.key)) continue;
      const slices = [...stateDurations(this._series(row), w.start, until)]
        .filter(([state]) => !isMissingState(state))
        .map(([state, time]) => ({ name: this._stateLabel(row, state), value: time / HOUR, color: this._stateColor(row, state) ?? '' }));
      if (!slices.length) continue;
      pies.push({ key: row.key, named: true, slices });
      names.push(this._view(row).name);
    }
    return { pies, names };
  }

  private _drawPie(chart: EChartsType, config: CardConfig, theme: Theme): void {
    const { pies, names } = this._pies(config);
    chart.setOption(
      buildPieOption({
        pies,
        donut: config.chartType === 'donut',
        theme,
        animation: config.animation,
        hover: !config.lightweight,
        width: chart.getWidth() || this._chartWidth || 600,
        height: chart.getHeight() || config.height,
      }),
      { notMerge: true },
    );
    const labelled = names.filter(Boolean).length > 0 && pies.length > 1;
    this._setOverlays([], labelled ? names.map((text, i) => ({ text, x: pieCentre(i, pies.length) * 100 })) : []);
  }

  /** The drawn time axis: the window plus the space set before and after it. */
  private _axisFor(w: TimeWindow): TimeWindow {
    const length = w.end - w.start;
    const room = (space?: { percent?: number; ms?: number }) =>
      space ? (space.ms ?? ((space.percent ?? 0) / 100) * length) : 0;
    const pad = this._config?.xPadding;
    return { start: w.start - room(pad?.left), end: w.end + room(pad?.right) };
  }

  /** One y-axis per unit: the first on the left, the second on the right, others unlabelled. */
  /**
   * One scale per unit, the first on the left and the second on the right. Units
   * of one family, such as W and kW, share a scale in the first one's unit; the
   * others are converted for drawing (`factorOf`), and their values keep their own unit.
   */
  private _axes(config: CardConfig): { axes: PlotAxis[]; axisOf: Map<string, number>; factorOf: Map<string, number> } {
    const ids: string[] = [];
    const axisUnits: string[] = [];
    const withBars: boolean[] = [];
    const units: string[] = [];
    const axisOf = new Map<string, number>();
    const factorOf = new Map<string, number>();
    for (const row of config.entities) {
      // An entity shown only in the values row adds no scale.
      if (!row.showInChart) continue;
      const kind = this._kind(row);
      if (kind !== 'line' && kind !== 'bar') continue;
      const unit = this._view(row).unit;
      let id = row.yAxis;
      if (!id) {
        let u = units.indexOf(unit);
        if (u < 0) u = units.findIndex((other) => sameFamily(other, unit));
        if (u < 0) u = units.push(unit) - 1;
        id = u === 0 ? 'left' : u === 1 ? 'right' : `unit:${unit}`;
      }
      let index = ids.indexOf(id);
      if (index < 0) {
        index = ids.push(id) - 1;
        axisUnits.push(unit);
        withBars.push(false);
      }
      if (kind === 'bar') withBars[index] = true;
      axisOf.set(row.key, index);
      factorOf.set(row.key, unitFactor(unit, axisUnits[index]));
    }
    if (!ids.length) {
      ids.push('left');
      axisUnits.push('');
      withBars.push(false);
    }
    const axes = ids.map((id, i) => ({
      position: id === 'right' ? ('right' as const) : ('left' as const),
      show: id === 'left' || id === 'right',
      unit: axisUnits[i],
      min: config.yAxes[id]?.min,
      max: config.yAxes[id]?.max,
      zero: withBars[i],
    }));
    return { axes, axisOf, factorOf };
  }

  /** A row's value at `ms`, as the tooltip writes it. */
  private _textAt(view: RowView, ms: number): string {
    const { row } = view;
    if (this._isHeatStates(row)) {
      const reading = this._heatHourReading(row, ms);
      return reading.unit ? `${reading.text} ${reading.unit}` : reading.text;
    }
    if (isStateKind(this._kind(row))) {
      const state = ms > this._latest(row) ? undefined : stateAt(this._series(row), ms);
      return state === undefined ? '-' : this._stateLabel(row, state);
    }
    const buckets = this._usesBuckets(row) ? this._buckets(row) : undefined;
    const value = this._attributeList(row)
      ? valueAt(this._attribute(row), ms)
      : buckets
        ? bucketAt(buckets, ms)
        : ms > this._latest(row)
          ? NaN
          : valueAt(this._series(row), ms);
    if (!Number.isFinite(value)) return '-';
    const text = this._numbers.format(value, view.decimals);
    return view.unit && view.row.showUnit ? `${text} ${view.unit}` : text;
  }

  /** The tooltip's colour key: the state's colour for timelines and bands, otherwise the entity colour. */
  private _keyColor(view: RowView, ms: number): string {
    if (!isStateKind(this._kind(view.row))) return view.color;
    const state = this._isHeatStates(view.row) ? this._heatHour(view.row, ms).state : stateAt(this._series(view.row), ms);
    return (state && this._stateColor(view.row, state)) ?? 'transparent';
  }

  private _hasVisibleData(): boolean {
    const w = this._window;
    const config = this._config;
    if (!w || !config) return false;
    if (config.chartType === 'pie' || config.chartType === 'donut') return this._pies(config).pies.length > 0;
    if (config.chartType === 'heatmap') return this._heatCells().length > 0;
    return config.entities.some((row) => {
      if (!row.showInChart) return false;
      if (this._usesBuckets(row)) return this._buckets(row)?.v.some((value) => Number.isFinite(value)) ?? false;
      const series = this._series(row);
      const i = indexAtOrBefore(series.t, w.end);
      if (i < 0) return false;
      const present = series.s ? !isMissingState(series.s[i]) : !Number.isNaN(series.v[i]);
      return series.t[i] >= w.start || (present && w.start <= Date.now());
    });
  }

  /** The heatmap's colour key: lowest and highest value with their colours. */
  private _heatScale(config: CardConfig, theme: Theme): HeatScale | undefined {
    if (config.chartType !== 'heatmap') return undefined;
    const row = this._heatRow();
    if (!row || isStateKind(this._kind(row))) return undefined;
    const cells = this._heatCells();
    if (!cells.length) return undefined;
    const view = this._view(row);
    const { min, max } = valueRange(cells);
    const unit = view.unit ? ` ${view.unit}` : '';
    return {
      min: `${this._numbers.format(min, view.decimals)}${unit}`,
      max: `${this._numbers.format(max, view.decimals)}${unit}`,
      from: heatColor(0, view.color, theme.background),
      to: heatColor(1, view.color, theme.background),
    };
  }

  /** Height of the chart canvas: the plot, plus the timeline strips under it. */
  private _chartHeight(config: CardConfig): number {
    if (!this._isTimeChart()) return config.height;
    const kinds = config.entities.filter((row) => row.showInChart).map((row) => this._kind(row));
    const strips = kinds.filter((kind) => kind === 'timeline').length;
    if (!strips) return config.height;
    const stripHeight = timelineHeight(strips, config.timeline.rowHeight, config.timeline.names);
    const hasMain = kinds.some((kind) => kind !== 'timeline');
    return hasMain ? config.height + stripHeight + 6 : stripHeight + timeLabelHeight(config.xAxis) + 8;
  }

  private _onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      if ((entry.target as HTMLElement).classList.contains('chart')) {
        this._chart?.resize();
        const width = entry.contentRect.width;
        if (Math.abs(width - this._chartWidth) > this._chartWidth * 0.1) {
          this._chartWidth = width;
          this._requestDraw(true);
        }
      } else {
        this._checkToolbar();
      }
    }
  }

  /**
   * Keeps the toolbar on one row. When it does not fit, the label first goes
   * onto two lines, then the menu button names the window briefly ("24h"
   * instead of "Past 24 hours"), then the label may be cut short. Each step
   * remembers the width it needed, to step back.
   */
  private _checkToolbar(): void {
    const bar = this.renderRoot.querySelector<HTMLElement>('.toolbar');
    if (!bar || !bar.clientWidth) return;
    const available = bar.clientWidth;
    if (bar.scrollWidth > available + 1 && this._toolbarLevel < 3) {
      this._levelWidths[this._toolbarLevel] = bar.scrollWidth;
      this._toolbarLevel++;
      this.requestUpdate();
    } else if (
      this._toolbarLevel > 0 &&
      available >= (this._levelWidths[this._toolbarLevel - 1] ?? Number.POSITIVE_INFINITY)
    ) {
      this._toolbarLevel--;
      this.requestUpdate();
    }
  }

  // ---- Visibility and the minute clock ----

  private _onVisibility = (): void => {
    if (document.visibilityState === 'visible') this._resume();
    else this._hiddenSince ??= Date.now();
  };

  private _setOnScreen(visible: boolean): void {
    if (visible === this._onScreen) return;
    this._onScreen = visible;
    if (visible) this._resume();
    else this._hiddenSince ??= Date.now();
  }

  private _resume(): void {
    if (!this._canDraw()) return;
    const hiddenFor = this._hiddenSince === undefined ? 0 : Date.now() - this._hiddenSince;
    this._hiddenSince = undefined;
    this._tick();
    const w = this._window;
    if (hiddenFor > 5 * MINUTE && w && containsNow(w, Date.now() - MINUTE)) this._scheduleLoad(0, true);
    else if (this._dirty) this._requestDraw(true);
  }

  private _startMinuteTimer(): void {
    this._stopMinuteTimer();
    this._minuteAlign = window.setTimeout(
      () => {
        this._tick();
        this._minuteTimer = window.setInterval(() => this._tick(), MINUTE);
      },
      MINUTE - (Date.now() % MINUTE) + 50,
    );
  }

  private _stopMinuteTimer(): void {
    clearTimeout(this._minuteAlign);
    clearInterval(this._minuteTimer);
  }

  /** Once a minute: rolling windows and spans slide, a new day starts "today", the now line moves. */
  private _tick(): void {
    const spec = this._spec;
    const w = this._window;
    if (!spec || !w || !this._config || !this._hass) return;
    const now = Date.now();
    if (slides(spec)) {
      this._window = resolveWindow(spec, now, this._weekStart);
      if (this._data && !this._loading) {
        for (const entity of this._data.entities.values()) trimBefore(entity.raw, this._window.start);
        this._version++;
      }
      this._refreshPeriods(now);
      this.requestUpdate();
      this._requestDraw();
      return;
    }
    if (followsCalendar(spec) && resolveWindow(spec, now, this._weekStart).start !== w.start) {
      this._applySpec(spec, true, 0);
      return;
    }
    if (containsNow(w, now)) {
      this._refreshPeriods(now);
      this._requestDraw();
    }
  }

  /** Bars, pies and heatmaps reload the period in progress every few minutes. */
  private _refreshPeriods(now: number): void {
    const data = this._data;
    if (!data?.buckets) return;
    const every = this._config?.lightweight ? 5 * MINUTE : MINUTE;
    if (now - data.loadedAt >= every) this._refresh();
  }

  // ---- Export ----

  private _exportCsv = async (): Promise<void> => {
    this._closeMenu();
    const config = this._config;
    const w = this._window;
    if (!config || !w || !this._data) return;
    try {
      const text = this._csvText(config, w);
      await saveFile(new Blob([text], { type: 'text/csv;charset=utf-8' }), exportFileName(config.title, w, 'csv'));
    } catch (err) {
      console.error('chart-explorer-card: CSV export failed', err);
    }
  };

  /**
   * What is shown, as CSV: lines and states as their recorded points, bars and
   * heatmap cells one row per period, a pie one row per slice.
   */
  private _csvText(config: CardConfig, w: TimeWindow): string {
    const header = (view: RowView, unit = true) => (unit && view.unit ? `${view.name} (${view.unit})` : view.name);
    if (config.chartType === 'pie' || config.chartType === 'donut') {
      const slices: CsvSlice[] = this._pieRows().map((item) => {
        const view = this._view(item.row);
        return { name: view.name, value: item.value, unit: view.unit, share: item.share };
      });
      const until = Math.min(w.end, Date.now());
      for (const row of config.entities) {
        if (!isStateKind(this._kind(row)) || !row.showInChart || this._faded.has(row.key)) continue;
        const durations = [...stateDurations(this._series(row), w.start, until)].filter(([state]) => !isMissingState(state));
        const total = durations.reduce((sum, [, time]) => sum + time, 0);
        for (const [state, time] of durations) {
          slices.push({
            name: `${this._view(row).name}: ${this._stateLabel(row, state)}`,
            value: Math.round((time / HOUR) * 1000) / 1000,
            unit: 'h',
            share: (time / total) * 100,
          });
        }
      }
      return buildPieCsv(slices, config.csv);
    }
    const heatRow = config.chartType === 'heatmap' ? this._heatRow() : undefined;
    if (heatRow && isStateKind(this._kind(heatRow))) return this._stateHeatCsv(config, heatRow);
    const now = Date.now();
    let start = w.start;
    let end = w.end <= now && w.end > now - MINUTE ? now + 1 : w.end;
    const rows =
      config.chartType === 'heatmap'
        ? [this._heatRow()].filter((row): row is EntityConfig => Boolean(row))
        : config.entities.filter((row) => row.showInChart && !this._faded.has(row.key));
    const columns: CsvColumn[] = rows.map((row): CsvColumn => {
      const view = this._view(row);
      if (row.attribute) {
        const list = this._attribute(row);
        return { header: header(view), t: list.t, v: list.v };
      }
      const buckets = this._usesBuckets(row) ? this._buckets(row) : undefined;
      if (buckets) {
        // Whole periods, including the parts before the window starts and after it ends.
        if (buckets.t.length) {
          start = Math.min(start, buckets.t[0]);
          end = Math.max(end, buckets.end[buckets.end.length - 1]);
        }
        return { header: header(view), t: buckets.t, v: buckets.v };
      }
      const series = this._series(row);
      if (isStateKind(this._kind(row))) return { header: header(view, false), t: series.t, v: series.v, s: series.s };
      return { header: header(view), t: series.t, v: series.v };
    });
    return buildCsv(columns, start, end, config.csv);
  }

  /** A heatmap of states, one row per hour: the state that held longest, then the minutes in each state. */
  private _stateHeatCsv(config: CardConfig, row: EntityConfig): string {
    const { periods } = this._stateHeat(row);
    const name = this._view(row).name;
    const t = periods.map((period) => period.start);
    const totals = new Map<string, number>();
    for (const period of periods) {
      for (const [state, time] of period.durations) totals.set(state, (totals.get(state) ?? 0) + time);
    }
    const columns: CsvColumn[] = [
      { header: name, t, v: [], s: periods.map((period) => this._stateLabel(row, mainState(period.durations) ?? '')) },
      ...[...totals]
        .sort((a, b) => b[1] - a[1])
        .map(([state]) => ({
          header: `${name}: ${this._stateLabel(row, state)} (min)`,
          t,
          v: periods.map((period) => Math.round(((period.durations.get(state) ?? 0) / MINUTE) * 10) / 10),
        })),
    ];
    const last = periods[periods.length - 1];
    return buildCsv(columns, t[0] ?? 0, last ? last.end : 0, config.csv);
  }

  private _exportPng = async (): Promise<void> => {
    this._closeMenu();
    const chart = this._chart;
    const config = this._config;
    const w = this._window;
    const spec = this._spec;
    if (!chart || !config || !w || !spec) return;
    this._draw();
    const theme = this._theme ?? readTheme(this, this._dark);
    try {
      const blob = await chartPng(chart, {
        title: config.title,
        range: this._times.rangeLabel(w, labelEndIsInclusive(spec), Date.now()),
        legend: [
          ...config.entities.map((row) => {
            const view = this._view(row);
            return { name: view.name, color: view.color, faded: this._faded.has(row.key) };
          }),
          ...(this._heatKey() ?? []).map((item) => ({ name: item.label, color: item.color ?? '', faded: false, square: true })),
        ],
        theme,
        fadedOpacity: config.fadedOpacity,
        units: this._unitLabels,
        unitSize: config.yAxis.labelSize,
        scale: this._heatScale(config, theme),
      });
      await saveFile(blob, exportFileName(config.title, w, 'png'));
    } catch (err) {
      console.error('chart-explorer-card: PNG export failed', err);
    }
  };

  // ---- Rendering ----

  protected override render() {
    const config = this._config;
    if (!config) return nothing;
    const bottom = config.toolbarPosition === 'bottom';
    const show = config.toolbar;
    const anyControl =
      show.arrows || show.now || show.presets || show.download || config.showRangeLabel;
    const toolbar = anyControl && config.toolbarPosition !== 'off' ? this._renderToolbar(config) : nothing;
    const values = this._renderValues(config);
    const below = config.valuesPlacement === 'below';
    return html`
      <ha-card class=${bottom ? 'bottom' : ''} style=${`--chart-height:${this._chartHeight(config)}px`}>
        ${config.title ? html`<div class="title">${config.title}</div>` : nothing}
        ${bottom ? nothing : toolbar} ${below ? nothing : values}
        <div class="chart-wrap drag-${config.dragAction}">
          ${this._loading || this._gestureLoading
            ? html`<div class="loading-bar" role="progressbar" aria-label=${t('loading')}></div>`
            : nothing}
          <div class="chart ${this._loading && this._data ? 'dim' : ''}"></div>
          <div class="selection"></div>
          ${this._unitLabels.map(
            (unit) => html`<span
              class="axis-unit"
              style=${`left:${unit.x}px;font-size:${config.yAxis.labelSize}px`}
              >${unit.text}</span
            >`,
          )}
          ${this._pieNames.map(
            (name) => html`<span class="pie-name" style=${`left:${name.x}%`}>${name.text}</span>`,
          )}
          ${this._renderTooltip(config)} ${this._renderMessage()}
        </div>
        ${this._renderHeatScale(config)}
        ${below ? values : nothing} ${bottom ? toolbar : nothing}
      </ha-card>
    `;
  }

  private _renderToolbar(config: CardConfig) {
    const spec = this._spec;
    const w = this._window;
    // While a drag or pinch is under way the label follows it.
    const shown = this._preview ?? w;
    const inclusive = !this._preview && spec ? labelEndIsInclusive(spec) : false;
    const [from, to] = shown ? this._times.rangeParts(shown, inclusive, Date.now()) : ['', ''];
    const level = this._toolbarLevel;
    const show = config.toolbar;
    // The menu holds the quick ranges and the entries, which may list lengths and presets alike;
    // its button names the window picked from either.
    const activeMenuItem = [...(show.quickRanges ? config.quickRanges : []), ...config.presets].find((item) =>
      this._isActive(item),
    );
    const activePreset = spec ? presetOf(spec) : undefined;
    const itemName = level >= 2 ? buttonLabel : menuLabel;
    const menuText = activeMenuItem ? itemName(activeMenuItem) : activePreset ? presetName(activePreset) : t('presets');
    const classes = `toolbar${level >= 1 ? ' stacked' : ''}${level >= 3 ? ' shrink' : ''}`;
    return html`
      <div class="toolbar-wrap">
        <div class=${classes}>
          ${show.arrows
            ? html`<button class="icon-button" title=${t('previous')} aria-label=${t('previous')} @click=${() => this._step(-1)}>
                ${icon('chevronLeft')}
              </button>`
            : nothing}
          ${show.now ? html`<button class="now" title=${t('now_hint')} @click=${this._goNow}>${t('now')}</button>` : nothing}
          ${show.arrows
            ? html`<button class="icon-button" title=${t('next')} aria-label=${t('next')} @click=${() => this._step(1)}>
                ${icon('chevronRight')}
              </button>`
            : nothing}
          ${config.showRangeLabel
            ? html`<button class="label" title=${t('edit_range')} @click=${() => this._toggleMenu('custom')}>
                <span>${from} -</span> <span>${to}</span>
              </button>`
            : html`<span class="label placeholder" aria-hidden="true"><span>${from} -</span> <span>${to}</span></span>`}
          ${show.presets
            ? html`<button
                class="with-icon ${activeMenuItem || activePreset ? 'active' : ''}"
                aria-haspopup="menu"
                aria-expanded=${this._menu === 'presets' ? 'true' : 'false'}
                @click=${() => this._toggleMenu('presets')}
              >
                ${menuText}${icon('menuDown')}
              </button>`
            : nothing}
          ${show.download
            ? html`<button
                class="icon-button"
                title=${t('download')}
                aria-label=${t('download')}
                aria-haspopup="menu"
                ?disabled=${!this._data}
                @click=${() => this._toggleMenu('export')}
              >
                ${icon('download')}
              </button>`
            : nothing}
        </div>
        ${this._menu === 'presets' ? this._renderPresetMenu(config) : nothing}
        ${this._menu === 'export' ? this._renderExportMenu() : nothing}
        ${this._menu === 'custom' ? this._renderCustom() : nothing}
      </div>
    `;
  }

  /** A quick range at the top of the Presets menu, such as "24h". */
  private _renderButton(item: RangeItem) {
    return html`<button
      class=${this._isActive(item) ? 'active' : ''}
      role="menuitem"
      @click=${() => this._applySpec(rangeItemSpec(item), true)}
    >
      ${buttonLabel(item)}
    </button>`;
  }

  private _renderPresetMenu(config: CardConfig) {
    return html`
      <div class="menu" role="menu">
        ${config.toolbar.quickRanges && config.quickRanges.length
          ? html`<div class="menu-top">
              <div class="section">${t('quick_ranges')}</div>
              <div class="chips">${config.quickRanges.map((item) => this._renderButton(item))}</div>
            </div>`
          : nothing}
        <div class="menu-list">
          ${config.presets.map(
            (item) =>
              html`<button
                role="menuitem"
                class=${this._isActive(item) ? 'active' : ''}
                @click=${() => this._applySpec(rangeItemSpec(item), true)}
              >
                ${menuLabel(item)}
              </button>`,
          )}
        </div>
        <div class="menu-bottom">
          <button role="menuitem" @click=${() => this._toggleMenu('custom')}>${t('custom')}</button>
        </div>
      </div>
    `;
  }

  private _renderExportMenu() {
    return html`
      <div class="menu" role="menu">
        <button role="menuitem" @click=${this._exportCsv}>${t('download_csv')}</button>
        <button role="menuitem" @click=${this._exportPng}>${t('download_png')}</button>
      </div>
    `;
  }

  private _renderCustom() {
    return html`
      <div class="popover" role="dialog" aria-label=${t('custom_range')}>
        <label>${t('from')}<input id="from" type="datetime-local" .value=${this._customFrom} /></label>
        <label>${t('to')}<input id="to" type="datetime-local" .value=${this._customTo} /></label>
        ${this._customError ? html`<div class="error">${this._customError}</div>` : nothing}
        <div class="actions">
          <button @click=${() => this._closeMenu()}>${t('cancel')}</button>
          <button class="active" @click=${this._applyCustom}>${t('apply')}</button>
        </div>
      </div>
    `;
  }

  private _renderValues(config: CardConfig) {
    const rows = config.entities.filter((row) => row.showInHeader);
    if (!rows.length) return nothing;
    return html`<div
      class="values pos-${config.valuePosition} align-${config.valuesAlign} name-${config.nameAlign} ${config.valuesPlacement}"
      style=${`--value-size:${config.valueSize}px;--name-size:${config.nameSize}px;--values-gap:${config.valuesGap}px`}
    >
      ${rows.map((row) => this._renderValue(row))}
    </div>`;
  }

  private _renderValue(row: EntityConfig) {
    const view = this._view(row);
    const faded = this._faded.has(row.key);
    const reading = this._reading(view);
    // Without its name, the value's hover text and screen-reader label say whose value it is.
    const named = row.showName && this._config?.showNames !== false;
    const title = reading.title ?? t('more_info');
    return html`
      <div class="item ${faded ? 'faded' : ''}" style=${`--item-color:${view.color}`}>
        <button
          class="value ${reading.numeric ? '' : 'text'}"
          style=${reading.color ? `color:${reading.color}` : nothing}
          title=${named ? title : `${view.name}: ${title}`}
          aria-label=${named ? nothing : `${view.name} ${reading.text}${reading.unit ? ` ${reading.unit}` : ''}`}
          @click=${() => this._moreInfo(row)}
        >
          ${reading.text}${reading.unit ? html`<span class="unit">${reading.unit}</span>` : nothing}
        </button>
        ${named
          ? html`<button
              class="name"
              title=${t('fade')}
              aria-pressed=${faded ? 'true' : 'false'}
              @click=${() => this._toggleFade(row)}
            >
              ${view.name}
            </button>`
          : nothing}
      </div>
    `;
  }

  private _renderHeatScale(config: CardConfig) {
    const states = this._heatKey();
    if (states) {
      return html`<div class="heat-scale states">
        ${states.map(
          (item) => html`<span class="state-key"
            ><i class=${item.color ? '' : 'striped'} style=${item.color ? `background:${item.color}` : nothing}></i
            >${item.label}</span
          >`,
        )}
      </div>`;
    }
    const scale = this._theme ? this._heatScale(config, this._theme) : undefined;
    if (!scale) return nothing;
    return html`<div class="heat-scale">
      <span>${scale.min}</span><i style=${`background:linear-gradient(90deg,${scale.from},${scale.to})`}></i
      ><span>${scale.max}</span>
    </div>`;
  }

  /** The optional floating box (`tooltip: true`) beside the cursor line. */
  private _renderTooltip(config: CardConfig) {
    const time = this._cursor;
    const chart = this._chart;
    if (!config.tooltip || time === undefined || !chart || !this._data) return nothing;
    const x = Number(chart.convertToPixel({ xAxisIndex: 0 }, time));
    if (!Number.isFinite(x)) return nothing;
    const onLeft = x > chart.getWidth() / 2;
    const rows = config.entities
      .filter((row) => !this._faded.has(row.key))
      .map((row) => this._view(row));
    const length = (this._window?.end ?? 0) - (this._window?.start ?? 0);
    const dateOnly = this._data.resolution === 'day' || this._data.resolution === 'week';
    return html`<div
      class="tooltip"
      style=${onLeft ? `right:${chart.getWidth() - x + 12}px` : `left:${x + 12}px`}
    >
      <div class="tooltip-time">${this._times.cursorLabel(time, length, dateOnly)}</div>
      ${rows.map(
        (view) => html`<div class="tooltip-row">
          <span class="key" style=${`background:${this._keyColor(view, time)}`}></span
          ><span class="tooltip-name">${view.name}</span><b>${this._textAt(view, time)}</b>
        </div>`,
      )}
    </div>`;
  }

  private _renderMessage() {
    if (this._error) {
      return html`<div class="message">
        <span>${t('load_failed')}</span>
        <small>${this._error}</small>
        <button @click=${this._retry}>${t('retry')}</button>
      </div>`;
    }
    if (this._loading && this._slow) return html`<div class="message">${t('loading')}</div>`;
    if (!this._loading && this._data && !this._hasVisibleData()) {
      // A ratio that cannot be worked out says why, instead of "No data for this range".
      const problem = this._config?.entities.map((row) => (row.ratio ? this._ratioProblem(row) : undefined)).find(Boolean);
      return html`<div class="message">${problem ?? t('no_data')}</div>`;
    }
    return nothing;
  }
}

/** Values multiplied by an entity's `multiply`, or as they are without one. */
function scaled(values: number[], factor: number | undefined): number[] {
  return factor === undefined ? values : values.map((value) => value * factor);
}

/** Continues the last value to `until`: a Home Assistant state holds until it changes. */
function extendLastValue(data: { t: number[]; v: number[] }, until: number): void {
  const n = data.t.length;
  if (!n || data.t[n - 1] >= until || Number.isNaN(data.v[n - 1])) return;
  data.t.push(until);
  data.v.push(data.v[n - 1]);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean }[];
  }
}

if (!customElements.get('chart-explorer-card')) {
  customElements.define('chart-explorer-card', ChartExplorerCard);
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: 'chart-explorer-card',
    name: 'Chart Explorer Card',
    description: 'Time-series chart with a time-range toolbar, drag zoom, and CSV and PNG export.',
    preview: true,
  });
  console.info(
    `%c CHART-EXPLORER-CARD %c ${VERSION} `,
    'color:#fff;background:#2a78d6;font-weight:600;border-radius:3px 0 0 3px',
    'color:#2a78d6;background:#e8f0fb;border-radius:0 3px 3px 0',
  );
}
