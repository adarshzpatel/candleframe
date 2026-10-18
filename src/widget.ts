import { ChartError } from './errors.ts';
import { createTimeFormats } from './time-format.ts';
import type { TimeFormats } from './time-format.ts';
import { loadWidgetFonts } from './widget-fonts.ts';
import type { WidgetFontSource } from './widget-fonts.ts';
import {
  chartThemes,
  colorRGBA,
  compactTheme,
  indicatorColor,
  resolveTheme,
  restoreTheme,
  systemThemeId,
} from './themes.ts';
import type { ThemeInput } from './themes.ts';
import { FOOTPRINT_DEFAULTS } from './footprint.ts';
import { CHART_TYPES, chartTypeLabel } from './chart-types.ts';
import { applyWidgetTheme } from './widget-theme.ts';
import { createThemeEditor } from './theme-editor.ts';
import { createChart } from './chart.ts';
import { createChartGroup } from './chart-group.ts';
import { createChartSwitch } from './chart-switch.ts';
import type { ChartSwitch } from './chart-switch.ts';
import { createGeometry } from './geometry.ts';
import type { ChartApi, ChartOptions } from './chart.ts';
import { createDrawingWorkbench } from './drawing-workbench.ts';
import { DrawingTemplates, type DrawingTemplateStore } from './drawing-templates.ts';
import { drawingWorkbenchStyles } from './drawing-workbench-style.ts';
import {
  DrawingFavourites,
  drawingFavouriteStyles,
  type DrawingFavouriteStore,
} from './drawing-favourites.ts';
import { drawingVisibilityStyles } from './drawing-visibility-form.ts';
import { uiIcon as icon } from './ui-icons.ts';
import { widgetStyles } from './widget-style.ts';
import {
  createIndicatorPanel,
  createIndicatorSettings,
  indicatorPanelStyles,
  renderIndicatorLegend,
} from './indicator-panel.ts';
import { stateTimeScale } from './geometry.ts';
import { intervalLabel, parseInterval } from './intervals.ts';
import { defineSelect, type CfSelectElement, type SelectItem } from './select.ts';
import {
  parseIntervalInput,
  resolveMarketFeed,
  supportsInterval,
  validateMarketSources,
} from './widget-market.ts';
import type { WidgetMarketSource } from './widget-market.ts';
import {
  cleanLayoutName,
  isLayoutPreset,
  LAYOUT_PRESETS,
  parseWorkspace,
  parseWorkspaceIndex,
  resolveLayout,
  SYNC_LABELS,
} from './widget-layout.ts';
import type {
  LayoutPreset,
  WidgetLayout,
  WidgetSync,
  WidgetWorkspace,
  WidgetWorkspaceIndex,
  WorkspaceCell,
} from './widget-layout.ts';
import type {
  Candle,
  ChartDocument,
  ChartType,
  FeedAdapter,
  Interval,
  Layer,
  RuntimeState,
} from './types.ts';
import type { RendererStats } from './webgl-renderer.ts';

export type { WidgetMarketSource } from './widget-market.ts';
export type {
  LayoutPreset,
  WidgetLayout,
  WidgetSync,
  WidgetWorkspace,
  WidgetWorkspaceIndex,
  WorkspaceCell,
} from './widget-layout.ts';
/** Values the widget stores: chart documents per market, saved layouts and their index. */
export type WidgetStoredValue = ChartDocument | WidgetWorkspace | WidgetWorkspaceIndex;
export interface WidgetLayoutStore {
  load(key: string): unknown | Promise<unknown>;
  save(key: string, value: WidgetStoredValue): void | Promise<void>;
  /** Deletes a saved layout. Without it, deleted layouts leave their record behind. */
  remove?(key: string): void | Promise<void>;
}
export interface ChartWidgetOptions extends ChartOptions {
  /** Factories return disconnected adapters; the selected adapter owns its connection. */
  markets?: readonly WidgetMarketSource[];
  /**
   * Enables browser persistence in this namespace, with Save and Revert buttons. Without
   * it, drawings and settings last for the session and those buttons stay hidden.
   */
  storageKey?: string;
  /** Shows an Inspect button that opens the chart's semantic state, for developers. Default false. */
  inspector?: boolean;
  /**
   * Widget fonts: `'bundled'` (default) loads them next to the module, a URL points at
   * self-hosted copies of `dist/lib/fonts/`, and `false` uses system fonts.
   */
  fonts?: WidgetFontSource;
  /** Optional application storage. Requires a storageKey namespace. */
  layoutStore?: WidgetLayoutStore;
  /**
   * Storage for drawing templates and saved tool defaults, such as an account service.
   * Without it they use browser storage under `storageKey`, or last for the session.
   */
  drawingTemplateStore?: DrawingTemplateStore;
  /**
   * Storage for favourite drawing tools and the favourites toolbar's place. Without it they
   * use browser storage under `storageKey`, or last for the session.
   */
  drawingFavouriteStore?: DrawingFavouriteStore;
  /**
   * Starting grid and sync settings. Grids of more than one chart need `markets`; new
   * charts copy the active chart's market. A saved layout replaces this once it loads.
   */
  layout?: { preset?: LayoutPreset; sync?: Partial<WidgetSync> };
}
/** The widget acts on its active chart, like its toolbar. */
export interface ChartWidgetApi extends ChartApi {
  /** Every chart in cell order. The widget owns them: do not dispose them. */
  charts(): readonly ChartApi[];
  getActiveChart(): number;
  setActiveChart(index: number): void;
  getLayout(): WidgetLayout;
  /** Changes the grid or sync settings. Extra charts copy the active chart's market. */
  setLayout(layout: { preset?: LayoutPreset; sync?: Partial<WidgetSync> }): void;
}

interface Cell {
  element: HTMLElement;
  chart: ChartApi;
  state?: RuntimeState;
  stats?: RendererStats;
  hovering: boolean;
  price: Intl.NumberFormat;
  timeFormats: TimeFormats;
  /** Market key whose saved document has loaded; autosave waits for it. */
  loadedKey: string | null;
  /**
   * The first load has run. Chart settings belong to the pane: the first load takes them
   * from the saved document, later market switches keep the pane's own.
   */
  paneLoaded?: boolean;
  savedRevision: number;
  saveTimer?: ReturnType<typeof setTimeout>;
  unsubscribe: () => void;
}

const cellMarkup = `<div class="chart-toolbar" part="chart-summary"><div class="market-summary"><span class="market-name"></span><span class="market-kind"></span><strong class="market-price" aria-label="Last price">—</strong></div><div class="ohlc-values"><span>O <b data-ohlc="open">—</b></span><span>H <b data-ohlc="high">—</b></span><span>L <b data-ohlc="low">—</b></span><span>C <b data-ohlc="close">—</b></span><span class="hover-time"></span></div><div class="chart-legend"><span class="legend-indicator"></span></div></div><div class="connection-notice" hidden><span class="connection-message"></span><button class="retry">Reconnect</button></div><div class="chart-host"></div>`;
const assetNames: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };

/** A complete, instance-isolated workbench. Only the host element's size is required. */
const INTERVAL_GROUPS = { time: 'Time', tick: 'Ticks', range: 'Range', momentum: 'Momentum' } as const;
const INTERVAL_EXAMPLES = { time: '3m', tick: '700t', range: '15r', momentum: '12mr' } as const;

export function createChartWidget(container: HTMLElement, options: ChartWidgetOptions): ChartWidgetApi {
  // The widget's pickers are <cf-select> elements.
  defineSelect(container.ownerDocument.defaultView?.customElements);
  const markets = options.markets ?? [];
  validateMarketSources(markets);
  if (options.layoutStore && !options.storageKey?.trim()) throw new ChartError('WIDGET_STORAGE_KEY_REQUIRED');
  let layout = resolveLayout(options.layout);
  if (options.layout?.preset !== undefined && !isLayoutPreset(options.layout.preset))
    throw new ChartError('INVALID_LAYOUT_PRESET', undefined, {
      path: 'layout.preset',
      details: { allowed: Object.keys(LAYOUT_PRESETS) },
    });
  const doc = container.ownerDocument,
    mount = doc.createElement('div');
  const themeKey = options.storageKey ? JSON.stringify([options.storageKey, 'appearance']) : null;
  // Intervals the user typed, per market source, newest first.
  const customKey = options.storageKey ? JSON.stringify([options.storageKey, 'custom-intervals']) : null;
  let customIntervals: Record<string, Interval[]> = {};
  try {
    if (customKey) customIntervals = JSON.parse(doc.defaultView?.localStorage.getItem(customKey) ?? '{}');
  } catch {}
  function rememberCustomInterval(sourceId: string, interval: Interval) {
    customIntervals[sourceId] = [
      interval,
      ...(customIntervals[sourceId] ?? []).filter(i => i !== interval),
    ].slice(0, 12);
    try {
      if (customKey) doc.defaultView?.localStorage.setItem(customKey, JSON.stringify(customIntervals));
    } catch {}
  }
  let initialTheme = resolveTheme(options.theme ?? systemThemeId(doc.defaultView));
  // Without a host or saved theme, the widget follows the system's light or dark setting.
  let followSystem = !options.theme;
  if (!options.theme && themeKey) {
    try {
      const saved = doc.defaultView?.localStorage.getItem(themeKey);
      if (saved) {
        initialTheme = restoreTheme(JSON.parse(saved));
        followSystem = false;
      }
    } catch {
      /* Invalid or unavailable storage leaves the default theme intact. */
    }
  }
  applyWidgetTheme(mount, initialTheme);
  loadWidgetFonts(doc, options.fonts);
  mount.className = 'candleframe-widget';
  Object.assign(mount.style, { width: '100%', height: '100%', minWidth: '0', minHeight: '0' });
  const shadow = mount.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent =
    widgetStyles +
    drawingWorkbenchStyles +
    drawingFavouriteStyles +
    drawingVisibilityStyles +
    indicatorPanelStyles;
  const root = doc.createElement('section');
  root.className = 'widget';
  root.setAttribute('aria-label', 'Chart widget');
  root.innerHTML = `<header class="widget-header">
    <div class="market-controls"><span class="asset-mark" id="asset-mark" aria-hidden="true">B</span><cf-select id="symbol" class="symbol-picker" aria-label="Symbol"></cf-select><span class="toolbar-divider"></span><cf-select id="interval" class="interval-picker" aria-label="Candle interval" search="off"></cf-select><span class="toolbar-divider"></span><button id="chart-type" class="icon-button" aria-label="Chart type" aria-haspopup="dialog" data-tooltip="Chart type">${icon('candles')}</button></div>
    <div class="analysis-controls"><button id="indicator-menu" aria-haspopup="dialog" data-tooltip="Add indicators">${icon('indicators')}<span>Indicators</span></button><button data-layer="volume" aria-label="Toggle volume" aria-pressed="true" data-tooltip="Volume">${icon('volume')}<span>Volume</span></button></div>
    <div class="widget-actions"><button id="draw-toggle" class="icon-button" aria-label="Drawing tools" aria-pressed="false" data-tooltip="Drawing tools">${icon('trendline')}</button><span class="toolbar-divider"></span><button id="pause" class="icon-button" aria-label="Pause feed" data-tooltip="Pause feed">${icon('pause')}</button><button id="layout" class="icon-button" aria-label="Chart layout" aria-haspopup="dialog" data-tooltip="Layout">${icon('layout')}</button><button id="save" class="icon-button" aria-label="Save layout" data-tooltip="Save layout">${icon('save')}</button><button id="restore" class="icon-button" aria-label="Revert to saved layout" data-tooltip="Revert to saved">${icon('restore')}</button><button id="theme" class="icon-button" aria-label="Chart appearance" data-tooltip="Appearance">${icon('palette')}</button><button id="export" class="icon-button" aria-label="Export PNG" data-tooltip="Export image">${icon('camera')}</button></div>
  </header>
  <div class="widget-body"><aside class="tool-rail" aria-label="Drawing tools"><button id="cursor" class="rail-button active" aria-label="Cursor tool" data-tooltip="Cursor">${icon('cursor')}</button><span class="rail-separator"></span><button id="trend" class="rail-button">${icon('trendline')}</button><span class="rail-separator"></span><button id="undo" class="rail-button" aria-label="Undo last edit" data-tooltip="Undo · ⌘ / Ctrl Z">${icon('undo')}</button><button id="clear" class="rail-button" aria-label="Clear drawings" data-tooltip="Clear drawings">${icon('trash')}</button><button id="fit" class="rail-button" aria-label="Fit chart to live data" data-tooltip="Fit chart">${icon('fit')}</button><button id="help" class="rail-button rail-bottom" aria-label="Chart controls and shortcuts" data-tooltip="Help & shortcuts">${icon('help')}</button></aside>
  <section class="chart-panel" aria-label="Charts"><div class="cell-tabs" role="tablist" aria-label="Charts"></div><div class="chart-grid" data-preset="1"></div></section></div>
  <footer class="widget-footer"><div class="range-buttons" role="group" aria-label="Bars in view"><span class="range-label" aria-hidden="true">Bars</span><button data-bars="60" aria-label="Show 60 bars">60</button><button data-bars="180" aria-label="Show 180 bars">180</button><button data-bars="360" aria-label="Show 360 bars">360</button><button data-bars="all" aria-label="Show all bars">All</button></div><span class="footer-divider"></span><cf-select id="source" class="source-picker" aria-label="Data source"></cf-select><span class="feed-state" id="feed-state"></span><button class="follow-button" id="follow">Following live</button><button class="autoscale-button" id="autoscale" aria-pressed="true" aria-label="Autoscale price" data-tooltip="Fit price to visible candles">Auto</button><button class="autoscale-button" id="log-scale" aria-pressed="false" aria-label="Logarithmic price scale" data-tooltip="Log scale: equal heights for equal percentage moves">Log</button><button id="inspect" class="icon-button" aria-label="Inspect state" data-tooltip="Inspect chart state">${icon('code', 16)}</button></footer>
  <div class="widget-tooltip" role="tooltip" hidden></div><div class="widget-toast" role="status" hidden></div><section class="widget-dialog" role="dialog" aria-modal="true" aria-label="Chart panel" hidden><header class="dialog-heading"><h2></h2><button class="icon-button" aria-label="Close dialog">${icon('close')}</button></header><div class="dialog-content"></div></section>`;
  shadow.append(style, root);
  container.append(mount);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const put = (element: Element, text: string) => {
    if (element.textContent !== text) element.textContent = text;
  };
  const set = (id: string, text: string) => put($(`#${id}`), text);
  const abort = new AbortController();
  let applyingSystemTheme = false;
  let disposed = false,
    toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bars shown when switching a wide view to footprints. */
  const FOOTPRINT_VIEW_BARS = 14;
  // Ranges count bars, not milliseconds, so session gaps do not shrink them.
  const barsRange = (state: RuntimeState, bars: number) => {
    const scale = stateTimeScale(state);
    const end = scale.logical(state.candles.at(-1)!.timeMs) + 12;
    return { fromMs: scale.time(end - bars), toMs: scale.time(end) };
  };
  const allRange = (state: RuntimeState) => {
    const scale = stateTimeScale(state);
    const end = scale.logical(state.candles.at(-1)!.timeMs) + 12;
    return barsRange(state, Math.min(2200, Math.max(20, end - scale.logical(state.candles[0].timeMs))));
  };
  // The active chart's state, as the toolbar last rendered it.
  let lastState: RuntimeState | undefined;
  const popup = $('.widget-dialog'),
    popupContent = $('.dialog-content');
  let popupFocus: HTMLElement | null = null;
  let themeEditor: ReturnType<typeof createThemeEditor> | undefined;
  const report = (message: string) => {
    if (disposed) return;
    const toast = $('.widget-toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  };
  function attempt(action: () => void) {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
  }
  let renderLayoutMenu: (() => void) | undefined;
  let renderChartTypeMenu: (() => void) | undefined;
  function openPanel(title: string, content: HTMLElement) {
    if (themeEditor && !content.contains(themeEditor.element)) {
      themeEditor.dispose();
      themeEditor = undefined;
    }
    // Safari does not focus clicked buttons, so fall back to the button that opened the panel.
    if (popup.hidden) popupFocus = (shadow.activeElement as HTMLElement | null) ?? lastInvoker;
    popup.classList.toggle('theme-dialog', title === 'Appearance');
    popup.classList.toggle('indicator-dialog', title === 'Indicators');
    popup.classList.toggle('layout-dialog', title === 'Layout');
    popup.classList.toggle('settings-dialog', content.classList.contains('indicator-settings'));
    popup.classList.toggle(
      'wide-dialog',
      ['Chart controls', 'Candle data', 'Chart state', 'Export chart'].includes(title),
    );
    if (title !== 'Layout') renderLayoutMenu = undefined;
    if (title !== 'Chart type') renderChartTypeMenu = undefined;
    popup.querySelector('h2')!.textContent = title;
    popup.setAttribute('aria-label', title);
    popupContent.replaceChildren(content);
    // Keep the anchor across panels opened from inside a panel, such as Candle data from Help.
    if (popup.hidden) popupAnchor = lastInvoker;
    popup.hidden = false;
    placePanel(popupAnchor);
    (content.querySelector<HTMLElement>('[data-autofocus]') ?? popup.querySelector('button')!).focus({
      preventScroll: true,
    });
  }
  let popupAnchor: HTMLElement | null = null;
  /** Every panel opens beside the control that opened it, clamped inside the widget. */
  function placePanel(anchor: HTMLElement | null) {
    const box = root.getBoundingClientRect(),
      header = $('.widget-header').getBoundingClientRect(),
      footer = $('.widget-footer').getBoundingClientRect();
    const a = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    const gap = 6,
      width = popup.offsetWidth;
    const top = header.bottom - box.top + gap,
      bottom = box.bottom - footer.top + gap;
    let left = box.width - width - 8;
    const style = popup.style;
    style.top = style.bottom = '';
    if (a && anchor!.closest('.tool-rail')) {
      // Beside the rail, level with the button; low buttons grow the panel upward.
      left = a.right - box.left + gap;
      if (a.top - box.top > box.height / 2) style.bottom = `${Math.max(bottom, box.bottom - a.bottom)}px`;
      else style.top = `${Math.max(top, a.top - box.top)}px`;
    } else if (a && anchor!.closest('.widget-footer')) {
      left = a.right - box.left - width;
      style.bottom = `${bottom}px`;
    } else if (a && !anchor!.closest('.widget-header')) {
      // Inside the chart, such as a legend's settings button.
      left = a.left - box.left;
      style.top = `${Math.max(top, a.bottom - box.top + gap)}px`;
    } else {
      if (a) left = a.left - box.left;
      style.top = `${top}px`;
    }
    style.left = `${Math.max(8, Math.min(left, box.width - width - 8))}px`;
    // One edge anchors; the stylesheet's default top must not stretch a bottom-anchored panel.
    if (!style.top) style.top = 'auto';
    if (!style.bottom) style.bottom = 'auto';
    const fromTop = style.top !== 'auto',
      offset = Number.parseFloat(fromTop ? style.top : style.bottom);
    style.maxHeight = `${Math.max(120, box.height - offset - (fromTop ? bottom : top))}px`;
  }
  function closePanel() {
    themeEditor?.dispose();
    themeEditor = undefined;
    renderLayoutMenu = undefined;
    renderChartTypeMenu = undefined;
    popup.hidden = true;
    if (popup.contains(shadow.activeElement)) popupFocus?.focus({ preventScroll: true });
  }
  popup.querySelector('button')!.addEventListener('click', closePanel, { signal: abort.signal });
  let lastInvoker: HTMLElement | null = null;
  root.addEventListener(
    'click',
    event => {
      const button = (event.target as Element | null)?.closest?.('button');
      if (button && !popup.contains(button)) lastInvoker = button;
    },
    { capture: true, signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && !popup.hidden) {
        event.stopPropagation();
        closePanel();
      }
      // The panel covers the chart, so keyboard focus stays inside it until Escape or Close.
      if (event.key === 'Tab' && !popup.hidden && popup.contains(shadow.activeElement)) {
        const focusable = [
          ...popup.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(element => !element.closest('[hidden]'));
        if (!focusable.length) return;
        // Move focus here rather than relying on the browser: macOS WebKit skips buttons on Tab.
        event.preventDefault();
        const index = focusable.indexOf(shadow.activeElement as HTMLElement);
        const step = event.shiftKey ? -1 : 1;
        focusable[(index + step + focusable.length) % focusable.length].focus();
      }
      // Alt + 1 to 8 selects a chart. `code` because Option + digit types a symbol on macOS.
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit && event.altKey && !event.ctrlKey && !event.metaKey && popup.hidden) {
        const cell = cells[Number(digit[1]) - 1];
        if (cell) {
          event.preventDefault();
          activate(cell);
          cell.element.querySelector<HTMLElement>('.cf-chart')?.focus({ preventScroll: true });
        }
      }
    },
    { signal: abort.signal },
  );
  const tooltip = $('.widget-tooltip');
  function hideTooltip() {
    tooltip.hidden = true;
  }
  function showTooltip(target: EventTarget | null) {
    const control = target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    if (!control?.dataset.tooltip || control.matches(':disabled,[aria-expanded=true]')) return;
    tooltip.textContent = control.dataset.tooltip;
    tooltip.hidden = false;
    const r = root.getBoundingClientRect(),
      c = control.getBoundingClientRect();
    const left = control.classList.contains('rail-button')
      ? c.right - r.left + 8
      : c.left - r.left + (c.width - tooltip.offsetWidth) / 2;
    const top = control.classList.contains('rail-button')
      ? c.top - r.top + (c.height - tooltip.offsetHeight) / 2
      : c.bottom - r.top + 8;
    tooltip.style.left = `${Math.max(8, Math.min(left, root.clientWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(top, root.clientHeight - tooltip.offsetHeight - 8))}px`;
  }
  root.addEventListener('pointerover', event => showTooltip(event.target), { signal: abort.signal });
  root.addEventListener('focusin', event => showTooltip(event.target), { signal: abort.signal });
  for (const name of ['pointerout', 'pointerdown', 'click', 'focusout', 'keydown'])
    root.addEventListener(name, hideTooltip, { signal: abort.signal });

  // Storage: one chart document per market, plus saved layouts and their index.
  const namespace = options.storageKey ?? 'session';
  const sessionLayouts = new Map<string, WidgetStoredValue>();
  const store: WidgetLayoutStore =
    options.layoutStore ??
    (options.storageKey
      ? {
          load: key => {
            const saved = doc.defaultView!.localStorage.getItem(key);
            return saved === null ? null : JSON.parse(saved);
          },
          save: (key, value) => doc.defaultView!.localStorage.setItem(key, JSON.stringify(value)),
          remove: key => doc.defaultView!.localStorage.removeItem(key),
        }
      : {
          load: key => sessionLayouts.get(key),
          save: (key, value) => {
            sessionLayouts.set(key, structuredClone(value));
          },
          remove: key => {
            sessionLayouts.delete(key);
          },
        });

  const panel = $('.chart-panel'),
    grid = $('.chart-grid'),
    tabs = $('.cell-tabs');
  const cells: Cell[] = [];
  let active: Cell;
  let switcher: ChartSwitch;
  let workbench: ReturnType<typeof createDrawingWorkbench> | undefined;
  let templates: DrawingTemplates | undefined;
  /** Saved tool defaults for the registered tools, as `setDrawingOptions` takes them. */
  const savedDefaults = (chart: ChartApi) => {
    const tools = new Set(chart.drawingTools().map(t => t.type));
    return Object.fromEntries(
      Object.entries(templates?.defaults() ?? {}).filter(([type]) => tools.has(type)),
    );
  };
  const group = createChartGroup([], layout.sync);
  const multi = () => cells.length > 1;
  const isActive = (cell: Cell) => cell === active;
  const layoutKey = (cell: Cell) =>
    cell.state
      ? JSON.stringify([
          namespace,
          cell.state.feed.id,
          cell.state.feed.instrument.symbol,
          cell.state.feed.interval,
        ])
      : null;

  function showCandle(cell: Cell, bar: Candle | null | undefined) {
    for (const element of cell.element.querySelectorAll<HTMLElement>('[data-ohlc]'))
      put(element, bar ? cell.price.format(bar[element.dataset.ohlc as 'open']) : '—');
  }
  function labelCell(cell: Cell) {
    const state = cell.state;
    if (!state) return;
    const instrument = state.feed.instrument;
    put(cell.element.querySelector('.market-name')!, assetNames[instrument.base] ?? instrument.base);
    const kind = cell.element.querySelector<HTMLElement>('.market-kind')!;
    // One chart: interval and source, as a legend. The header already names the symbol.
    const source =
      markets.find(s => s.id === state.feed.id)?.label ?? (state.feed.simulated ? 'Simulated' : '');
    const label = multi()
      ? `${instrument.symbol}|${state.feed.interval}`
      : `${state.feed.interval}|${source}`;
    if (kind.dataset.label === label) return;
    kind.dataset.label = label;
    if (!multi()) {
      const interval = doc.createElement('span');
      interval.className = 'market-interval';
      interval.textContent = state.feed.interval;
      kind.replaceChildren(interval, source ? ` · ${source}` : '');
    } else {
      // Intervals keep their case: 1m is a minute, 1M would read as a month.
      const interval = doc.createElement('span');
      interval.className = 'market-interval';
      interval.textContent = state.feed.interval;
      kind.replaceChildren(`${instrument.symbol} · `, interval);
    }
  }
  /** The parts of a cell that follow its own chart: summary, legend and connection notice. */
  function renderCell(cell: Cell, state: RuntimeState) {
    const previous = cell.state;
    cell.state = state;
    if (state.feed.intervalMs !== previous?.feed.intervalMs)
      cell.timeFormats = createTimeFormats(state.feed.intervalMs, options.timeZone);
    const q = (selector: string) => cell.element.querySelector<HTMLElement>(selector)!;
    // Every indicator gets a legend row; its buttons are the only way to hide, edit or remove it.
    const theme = cell.chart.getTheme();
    const layerOn = state.document.layers.indicator;
    const plugins = new Map(state.indicators.map(i => [i.plugin.id, i.plugin]));
    const items = state.document.indicators.map(entry => {
      const plugin = plugins.get(entry.id);
      const [r, g, b] =
        !plugin || plugin.pane === 'profile'
          ? colorRGBA(theme.palette.textMuted)
          : indicatorColor(theme, plugin);
      return {
        id: entry.id,
        name: plugin?.name ?? entry.kind,
        color: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
        shown: layerOn && entry.visible,
      };
    });
    const host = q('.legend-indicator');
    host.hidden = !items.length;
    const legend = JSON.stringify(items);
    if (host.dataset.items !== legend) {
      host.dataset.items = legend;
      const chart = cell.chart;
      // Rebuilding drops focus; put it back on the same button, which may now say Show.
      const focused = host.contains(shadow.activeElement)
        ? [...host.querySelectorAll('button')].indexOf(shadow.activeElement as HTMLButtonElement)
        : -1;
      renderIndicatorLegend(host, doc, items, {
        toggle: id =>
          attempt(() => {
            const entry = chart.inspect().document.indicators.find(i => i.id === id);
            if (!entry) return;
            // With the layer off every indicator reads as hidden; showing one turns the layer back on.
            if (!chart.inspect().document.layers.indicator) {
              chart.execute({ type: 'layer.set', layer: 'indicator', visible: true });
              if (!entry.visible) chart.execute({ type: 'indicator.update', id, visible: true });
            } else chart.execute({ type: 'indicator.update', id, visible: !entry.visible });
          }),
        settings: id => {
          const name = items.find(item => item.id === id)?.name ?? 'Indicator';
          openPanel(`${name} settings`, createIndicatorSettings(chart, doc, id, report));
        },
        remove: id => attempt(() => chart.execute({ type: 'indicator.remove', id })),
      });
      if (focused >= 0) host.querySelectorAll('button')[focused]?.focus({ preventScroll: true });
    }
    if (
      previous &&
      previous.dataRevision === state.dataRevision &&
      previous.stream === state.stream &&
      previous.paused === state.paused &&
      previous.generation === state.generation
    )
      return;
    if (previous?.feed !== state.feed) {
      cell.price = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: state.feed.instrument.pricePrecision,
        maximumFractionDigits: state.feed.instrument.pricePrecision,
      });
      labelCell(cell);
    }
    if (previous?.generation !== state.generation) cell.hovering = false;
    put(q('.market-price'), state.candles.length ? cell.price.format(state.candles.at(-1)!.close) : '—');
    if (!cell.hovering) showCandle(cell, state.candles.at(-1));
    const { status, message } = state.stream;
    const issue = status === 'error' || status === 'stale';
    q('.connection-notice').hidden = !issue;
    if (issue) put(q('.connection-message'), message ?? status);
  }

  // Autosave per chart. It waits for the market's saved document to load, so a fresh
  // chart never overwrites it. Only drawings are per market; indicators, layers and chart
  // type are chart settings that stay with the pane.
  const documentContent = (d: Readonly<ChartDocument>) => JSON.stringify(d.drawings);
  const paneSettings = (d: Readonly<ChartDocument>) => ({
    layers: d.layers,
    indicators: d.indicators,
    chartType: d.chartType ?? 'candles',
    ...(d.footprint ? { footprint: d.footprint } : {}),
  });
  async function saveCell(cell: Cell, manual = false) {
    clearTimeout(cell.saveTimer);
    cell.saveTimer = undefined;
    const key = layoutKey(cell);
    if (!key || (!manual && cell.loadedKey !== key)) return;
    const document = cell.chart.exportDocument();
    cell.savedRevision = cell.chart.inspect().documentRevision;
    shareDocument(cell, key, document);
    try {
      await store.save(key, document);
      if (manual) report(options.storageKey ? 'Layout saved.' : 'Layout saved for this widget session.');
    } catch (error) {
      report(`Could not save layout: ${String(error)}`);
    }
  }
  /** Charts showing the same market share one document; each keeps its own view. */
  function shareDocument(source: Cell, key: string, document: ChartDocument) {
    for (const other of cells) {
      if (other === source || other.loadedKey !== key || layoutKey(other) !== key || !other.state) continue;
      const current = other.state.document;
      if (documentContent(current) === documentContent(document)) continue;
      // The restore publishes one revision; mark it saved so it is not written back.
      other.savedRevision = other.state.documentRevision + 1;
      try {
        other.chart.restoreDocument(
          {
            ...document,
            ...paneSettings(current),
            viewport: current.viewport,
            priceScale: current.priceScale,
          },
          undefined,
          { undoable: false },
        );
        other.savedRevision = other.chart.inspect().documentRevision;
      } catch {
        /* A chart that cannot read it keeps its own document. */
      }
    }
  }
  function scheduleSave(cell: Cell, state: RuntimeState) {
    if (cell.saveTimer || cell.loadedKey !== layoutKey(cell) || state.documentRevision === cell.savedRevision)
      return;
    cell.saveTimer = setTimeout(() => void saveCell(cell), 400);
  }
  const flushCell = (cell: Cell) => {
    if (cell.saveTimer) void saveCell(cell);
  };
  /** Loads the saved document for the cell's market, keeping the live viewport. */
  async function loadCell(cell: Cell) {
    const key = layoutKey(cell);
    if (!key) return;
    cell.loadedKey = null;
    const chart = cell.chart;
    const before = chart.inspect();
    const edits = JSON.stringify([before.document.drawings, before.document.indicators]);
    try {
      const saved = await store.load(key);
      const now = chart.inspect();
      if (disposed || !cells.includes(cell) || now.generation !== before.generation) return;
      // Keep anything drawn while a slow store was loading.
      if (saved && JSON.stringify([now.document.drawings, now.document.indicators]) === edits) {
        const { log } = now.document.priceScale;
        chart.restoreDocument(
          {
            ...(saved as ChartDocument),
            ...(cell.paneLoaded ? paneSettings(now.document) : {}),
            viewport: now.document.viewport,
            priceScale: log ? { mode: 'auto', log } : { mode: 'auto' },
          },
          now.documentRevision,
          { undoable: false },
        );
      }
    } catch (error) {
      if (!disposed) report(`Could not load saved layout: ${String(error)}`);
    }
    if (disposed || !cells.includes(cell) || layoutKey(cell) !== key) return;
    cell.savedRevision = chart.inspect().documentRevision;
    cell.loadedKey = key;
    cell.paneLoaded = true;
    if (cell.state) scheduleSave(cell, cell.state);
  }
  async function restoreCell(cell: Cell) {
    const chart = cell.chart,
      before = chart.inspect();
    try {
      const saved = await store.load(layoutKey(cell)!);
      if (disposed) return;
      if (saved === null || saved === undefined) {
        report('No saved layout for this market.');
        return;
      }
      if (chart.inspect().generation !== before.generation)
        throw new ChartError('MARKET_CHANGED_DURING_RESTORE');
      chart.restoreDocument(saved, before.documentRevision);
      report('Layout restored.');
    } catch (error) {
      report(`Could not restore layout: ${String(error)}`);
    }
  }

  const marketOf = (cell: Cell): WorkspaceCell | null =>
    cell.state
      ? {
          source: cell.state.feed.id,
          symbol: cell.state.feed.instrument.symbol,
          interval: cell.state.feed.interval,
        }
      : null;
  function feedFor(market: WorkspaceCell | null): FeedAdapter {
    const source = markets.find(s => s.id === market?.source);
    if (
      source &&
      market &&
      source.symbols.includes(market.symbol) &&
      supportsInterval(source, market.interval)
    )
      return resolveMarketFeed(source, market);
    // The host's feed may not be in the catalog; start from the catalog's first market.
    const first = markets[0];
    if (!first)
      throw new ChartError('WIDGET_MARKETS_REQUIRED', 'grids of more than one chart need the markets option');
    return resolveMarketFeed(first, { symbol: first.symbols[0], interval: first.intervals[0] });
  }
  /** Points a cell at another market; its saved document loads once the feed changes. */
  function setCellMarket(cell: Cell, market: WorkspaceCell) {
    const current = marketOf(cell);
    if (
      current &&
      current.source === market.source &&
      current.symbol === market.symbol &&
      current.interval === market.interval
    )
      return;
    const source = markets.find(s => s.id === market.source);
    if (!source) throw new ChartError('MARKET_SOURCE_UNAVAILABLE');
    const feed = resolveMarketFeed(source, market);
    flushCell(cell);
    cell.chart.replaceFeed(feed);
  }

  function addCell(feed: FeedAdapter): Cell {
    const element = doc.createElement('section');
    element.className = 'chart-cell';
    element.innerHTML = cellMarkup;
    grid.append(element);
    const cell = {
      element,
      hovering: false,
      price: new Intl.NumberFormat('en-US'),
      timeFormats: createTimeFormats(feed.descriptor.intervalMs, options.timeZone),
      loadedKey: null,
      savedRevision: -1,
      unsubscribe: () => {},
    } as Omit<Cell, 'chart'> as Cell;
    try {
      cell.chart = createChart(element.querySelector<HTMLElement>('.chart-host')!, {
        ...options,
        feed,
        // Later charts open in the appearance the user has now.
        theme: cells.length ? switcher.api.getTheme() : initialTheme,
        onThemeChange(theme) {
          // Appearance applies to every chart; react once, for the active one.
          if (!isActive(cell)) return;
          // A choice in Appearance or through the API stops the widget following the system.
          if (!applyingSystemTheme) followSystem = false;
          applyWidgetTheme(mount, theme);
          themeEditor?.sync(theme);
          for (const button of root.querySelectorAll<HTMLButtonElement>('[data-theme]'))
            button.setAttribute(
              'aria-pressed',
              String(
                button.dataset.theme === theme.id &&
                  JSON.stringify(chartThemes[theme.id as keyof typeof chartThemes]) === JSON.stringify(theme),
              ),
            );
          if (themeKey && !followSystem) {
            try {
              // Only the differences, so later default changes still reach this widget.
              doc.defaultView?.localStorage.setItem(themeKey, JSON.stringify(compactTheme(theme)));
            } catch {
              /* Theme changes still work when browser storage is unavailable. */
            }
          }
          options.onThemeChange?.(theme);
        },
        onDrawingChange(value) {
          if (!isActive(cell)) return;
          workbench?.interaction(value);
          options.onDrawingChange?.(value);
        },
        onDrawingEdit(value) {
          if (!isActive(cell)) return;
          closePanel();
          workbench?.editDrawing(value);
          options.onDrawingEdit?.(value);
        },
        onError(error) {
          report(multi() ? `Chart ${cells.indexOf(cell) + 1}: ${error.message}` : error.message);
          options.onError?.(error);
        },
        onHover(bar) {
          cell.hovering = !!bar;
          showCandle(cell, bar ?? cell.state?.candles.at(-1));
          put(
            element.querySelector('.hover-time')!,
            bar ? `${cell.timeFormats.full(bar.timeMs)} ${cell.timeFormats.zone}` : '',
          );
          if (isActive(cell)) options.onHover?.(bar);
        },
        onStats(stats) {
          cell.stats = stats;
          if (isActive(cell)) options.onStats?.(stats);
        },
      });
    } catch (error) {
      element.remove();
      throw error;
    }
    // Later charts start with the tool defaults the user has now.
    if (cells.length)
      cell.chart.setDrawingOptions({ toolDefaults: active.chart.drawingState().options.toolDefaults });
    cells.push(cell);
    cell.unsubscribe = cell.chart.subscribe(state => {
      const previous = cell.state;
      renderCell(cell, state);
      // A new market loads its own saved document, however the feed was replaced.
      if (previous && previous.generation !== state.generation && layoutKey(cell) !== cell.loadedKey)
        queueMicrotask(() => {
          if (!disposed && cells.includes(cell) && layoutKey(cell) !== cell.loadedKey) void loadCell(cell);
        });
      scheduleSave(cell, state);
      if (previous && previous.feed !== state.feed && multi()) {
        renderGrid();
        scheduleWorkspaceSave();
      }
    });
    element.addEventListener('pointerdown', () => activate(cell), { capture: true, signal: abort.signal });
    element.addEventListener('focusin', () => activate(cell), { signal: abort.signal });
    element.querySelector('.retry')!.addEventListener(
      'click',
      () =>
        attempt(() => {
          cell.chart.execute({ type: 'feed.pause', paused: true });
          cell.chart.execute({ type: 'feed.pause', paused: false });
        }),
      { signal: abort.signal },
    );
    group.add(cell.chart);
    void loadCell(cell);
    return cell;
  }
  function removeCell(cell: Cell) {
    if (cell === active) activate(cells.find(other => other !== cell)!);
    flushCell(cell);
    clearTimeout(cell.saveTimer);
    group.remove(cell.chart);
    cell.unsubscribe();
    cell.chart.dispose();
    cell.element.remove();
    cells.splice(cells.indexOf(cell), 1);
  }

  /** Makes a cell the one the toolbar, drawing tools and keyboard shortcuts act on. */
  function activate(cell: Cell) {
    if (cell === active || !cells.includes(cell)) return;
    const previous = active;
    const tool = previous.chart.drawingState().tool;
    active = cell;
    // The toolbar redraws everything for the new chart.
    lastState = undefined;
    switcher.set(cell.chart);
    previous.chart.selectDrawing(null);
    // A chosen drawing tool follows the click, so a line can start on any chart.
    if (tool !== 'cursor') {
      previous.chart.setTool('cursor');
      cell.chart.setTool(tool);
    }
    workbench?.interaction(cell.chart.drawingState());
    renderGrid();
    scheduleWorkspaceSave();
  }
  function renderGrid() {
    const preset = LAYOUT_PRESETS[layout.preset];
    grid.dataset.preset = layout.preset;
    grid.style.gridTemplateColumns = `repeat(${preset.columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${preset.rows}, minmax(0, 1fr))`;
    grid.toggleAttribute('data-multi', multi());
    panel.toggleAttribute('data-multi', multi());
    const buttons = [...tabs.children] as HTMLButtonElement[];
    cells.forEach((cell, i) => {
      cell.element.classList.toggle('active', cell === active);
      cell.element.setAttribute('aria-label', multi() ? `Chart ${i + 1} of ${cells.length}` : 'Price chart');
      labelCell(cell);
      let tab = buttons[i];
      if (!tab) {
        tab = doc.createElement('button');
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => activate(cells[i]), { signal: abort.signal });
        tabs.append(tab);
      }
      const market = marketOf(cell);
      tab.textContent = market ? `${market.symbol.split('/')[0]} ${market.interval}` : String(i + 1);
      tab.setAttribute('aria-label', `Chart ${i + 1}`);
      tab.setAttribute('aria-selected', String(cell === active));
    });
    buttons.slice(cells.length).forEach(button => button.remove());
    renderLayoutMenu?.();
  }
  /** Grows or shrinks the grid. New charts take `fill` markets, else the active chart's. */
  function applyPreset(preset: LayoutPreset, fill: readonly WorkspaceCell[] = []) {
    const count = LAYOUT_PRESETS[preset].cells;
    if (count > 1 && !markets.length)
      throw new ChartError('WIDGET_MARKETS_REQUIRED', 'grids of more than one chart need the markets option');
    // Create first, so a failing feed leaves the grid as it was.
    const feeds: FeedAdapter[] = [];
    for (let i = cells.length; i < count; i++) feeds.push(feedFor(fill[i] ?? marketOf(active)));
    while (cells.length > count) removeCell(cells.at(-1)!);
    for (const feed of feeds) addCell(feed);
    layout = { ...layout, preset };
    renderGrid();
    group.align(active.chart);
  }
  function updateSync(next: Partial<WidgetSync>) {
    const before = layout.sync;
    const sync = { ...before };
    for (const key of Object.keys(SYNC_LABELS) as (keyof WidgetSync)[])
      if (typeof next[key] === 'boolean') sync[key] = next[key]!;
    layout = { ...layout, sync };
    group.setSync({ crosshair: sync.crosshair, time: sync.time, dateRange: sync.dateRange });
    // Turning a link on brings the other charts to the active one, as a change would.
    if ((sync.time && !before.time) || (sync.dateRange && !before.dateRange)) group.align(active.chart);
    if ((sync.symbol && !before.symbol) || (sync.interval && !before.interval)) linkMarkets(active);
    renderLayoutMenu?.();
  }
  /** Applies the source cell's symbol and/or interval to the others, as sync allows. */
  function linkMarkets(source: Cell) {
    const from = marketOf(source);
    if (!from || !multi() || (!layout.sync.symbol && !layout.sync.interval)) return;
    for (const cell of cells) {
      const current = marketOf(cell);
      if (cell === source || !current) continue;
      const target = { ...current };
      if (layout.sync.symbol) Object.assign(target, { source: from.source, symbol: from.symbol });
      if (layout.sync.interval) target.interval = from.interval;
      const catalog = markets.find(s => s.id === target.source);
      if (!catalog?.symbols.includes(target.symbol)) continue;
      if (!supportsInterval(catalog, target.interval)) {
        if (layout.sync.interval) continue;
        target.interval = catalog.intervals[0];
      }
      attempt(() => setCellMarket(cell, target));
    }
  }

  // Saved layouts. The index is written only once the user changes something.
  const indexKey = JSON.stringify([namespace, 'workspaces']);
  const workspaceKey = (id: string) => JSON.stringify([namespace, 'workspace', id]);
  let workspaces: WidgetWorkspaceIndex = {
    version: 1,
    current: 'default',
    items: [{ id: 'default', name: 'Default layout' }],
  };
  let workspaceReady = false,
    workspaceTimer: ReturnType<typeof setTimeout> | undefined;
  const currentName = () => workspaces.items.find(item => item.id === workspaces.current)?.name ?? 'Layout';
  function snapshotWorkspace(): WidgetWorkspace {
    return {
      version: 1,
      name: currentName(),
      preset: layout.preset,
      sync: { ...layout.sync },
      active: Math.max(0, cells.indexOf(active)),
      cells: cells.map(marketOf).filter((market): market is WorkspaceCell => !!market),
    };
  }
  function scheduleWorkspaceSave() {
    if (!workspaceReady || disposed || workspaceTimer) return;
    workspaceTimer = setTimeout(() => void saveWorkspace(), 400);
  }
  async function saveWorkspace() {
    clearTimeout(workspaceTimer);
    workspaceTimer = undefined;
    if (!workspaceReady) return;
    try {
      await store.save(workspaceKey(workspaces.current), snapshotWorkspace());
      await store.save(indexKey, structuredClone(workspaces));
    } catch (error) {
      report(`Could not save layout: ${String(error)}`);
    }
  }
  const flushWorkspace = () => {
    if (workspaceTimer) void saveWorkspace();
  };
  /** `initial` keeps the first chart on the host's feed. */
  function applyWorkspace(workspace: WidgetWorkspace, initial: boolean) {
    const fill = workspace.cells;
    if (LAYOUT_PRESETS[workspace.preset].cells > 1 && !markets.length) return;
    applyPreset(workspace.preset, fill);
    cells.forEach((cell, i) => {
      if (fill[i] && !(initial && i === 0)) attempt(() => setCellMarket(cell, fill[i]));
    });
    activate(cells[Math.min(workspace.active, cells.length - 1)]);
    updateSync(workspace.sync);
  }
  async function loadWorkspaces() {
    try {
      const index = parseWorkspaceIndex(await store.load(indexKey));
      if (disposed) return;
      if (index) {
        workspaces = index;
        const saved = parseWorkspace(await store.load(workspaceKey(index.current)));
        if (disposed) return;
        if (saved) attempt(() => applyWorkspace(saved, true));
      }
    } catch (error) {
      if (!disposed) report(`Could not load saved layouts: ${String(error)}`);
    }
    workspaceReady = true;
    renderLayoutMenu?.();
  }
  async function switchWorkspace(id: string) {
    if (id === workspaces.current) return;
    flushWorkspace();
    cells.forEach(flushCell);
    try {
      const saved = parseWorkspace(await store.load(workspaceKey(id)));
      if (disposed) return;
      workspaces = { ...workspaces, current: id };
      if (saved) applyWorkspace(saved, false);
      await store.save(indexKey, structuredClone(workspaces));
      report(`Opened ${currentName()}.`);
    } catch (error) {
      report(`Could not open layout: ${String(error)}`);
    }
    renderLayoutMenu?.();
  }
  async function saveWorkspaceAs(name: string) {
    const clean = cleanLayoutName(name);
    if (!clean) throw new ChartError('INVALID_LAYOUT_NAME', 'enter a name');
    flushWorkspace();
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    workspaces = { ...workspaces, current: id, items: [...workspaces.items, { id, name: clean }] };
    workspaceReady = true;
    await saveWorkspace();
    report(`Saved ${clean}.`);
    renderLayoutMenu?.();
  }
  function renameWorkspace(id: string, name: string) {
    const clean = cleanLayoutName(name);
    if (!clean) throw new ChartError('INVALID_LAYOUT_NAME', 'enter a name');
    workspaces = {
      ...workspaces,
      items: workspaces.items.map(item => (item.id === id ? { ...item, name: clean } : item)),
    };
    if (id === workspaces.current) void saveWorkspace();
    else void store.save(indexKey, structuredClone(workspaces));
    renderLayoutMenu?.();
  }
  async function deleteWorkspace(id: string) {
    if (workspaces.items.length < 2) throw new ChartError('LAST_LAYOUT', 'keep at least one layout');
    const name = workspaces.items.find(item => item.id === id)?.name;
    const items = workspaces.items.filter(item => item.id !== id);
    if (id === workspaces.current) {
      clearTimeout(workspaceTimer);
      workspaceTimer = undefined;
      workspaces = { ...workspaces, items, current: '' };
      await switchWorkspace(items[0].id);
    } else workspaces = { ...workspaces, items };
    try {
      await store.save(indexKey, structuredClone(workspaces));
      await store.remove?.(workspaceKey(id));
      report(`Deleted ${name}.`);
    } catch (error) {
      report(`Could not delete layout: ${String(error)}`);
    }
    renderLayoutMenu?.();
  }

  let unsubscribe = () => {};
  try {
    active = addCell(options.feed);
    switcher = createChartSwitch(active.chart, () => cells.map(cell => cell.chart));
    const chart = switcher.api;
    const templateKey = options.storageKey ? JSON.stringify([options.storageKey, 'drawing-templates']) : null;
    templates = new DrawingTemplates(
      chart.drawingTools(),
      options.drawingTemplateStore ??
        (templateKey
          ? {
              load() {
                try {
                  return JSON.parse(doc.defaultView?.localStorage.getItem(templateKey) ?? 'null');
                } catch {
                  return null;
                }
              },
              save(value) {
                try {
                  doc.defaultView?.localStorage.setItem(templateKey, JSON.stringify(value));
                } catch {
                  /* Templates still work for this session when browser storage is unavailable. */
                }
              },
            }
          : undefined),
      error => report(`Drawing templates: ${error instanceof Error ? error.message : String(error)}`),
    );
    void templates.load().then(() => {
      if (!disposed) attempt(() => chart.setDrawingOptions({ toolDefaults: savedDefaults(chart) }));
    });
    const favouriteKey = options.storageKey
      ? JSON.stringify([options.storageKey, 'drawing-favourites'])
      : null;
    const favourites = new DrawingFavourites(
      options.drawingFavouriteStore ??
        (favouriteKey
          ? {
              load() {
                try {
                  return JSON.parse(doc.defaultView?.localStorage.getItem(favouriteKey) ?? 'null');
                } catch {
                  return null;
                }
              },
              save(value) {
                try {
                  doc.defaultView?.localStorage.setItem(favouriteKey, JSON.stringify(value));
                } catch {
                  /* Favourites still work for this session when browser storage is unavailable. */
                }
              },
            }
          : undefined),
      error => report(`Drawing favourites: ${error instanceof Error ? error.message : String(error)}`),
    );
    void favourites.load();
    workbench = createDrawingWorkbench(chart, {
      root,
      rail: $('.tool-rail'),
      panel,
      templates,
      favourites,
      report,
    });
    // Stable styling hooks for host-specific chrome beyond the shared canvas theme.
    for (const [selector, part] of Object.entries({
      '.widget': 'widget',
      '.widget-header': 'toolbar',
      '.tool-rail': 'drawing-toolbar',
      '.chart-panel': 'chart-panel',
      '.widget-footer': 'footer',
      '.widget-dialog': 'dialog',
      '.drawing-strip': 'drawing-controls',
      '.drawing-flyout': 'drawing-menu',
      '.drawing-object-panel': 'drawing-properties',
      '.drawing-text-editor': 'text-editor',
      '.drawing-favourites': 'drawing-favourites',
    })) {
      (root.matches(selector) ? root : root.querySelector(selector))?.setAttribute('part', part);
    }
    const on = (selector: string, action: () => void) =>
      $(selector).addEventListener('click', () => attempt(action), { signal: abort.signal });
    // Controls that cannot act are hidden rather than left inert.
    $('#layout').hidden = !markets.length;
    $('#source').hidden = markets.length < 2;
    $('#save').hidden = $('#restore').hidden = !options.storageKey;
    $('#inspect').hidden = !options.inspector;
    // Narrow widgets fold the drawing rail away; the header toggle brings it back.
    on('#draw-toggle', () => {
      const open = !root.hasAttribute('data-rail-open');
      root.toggleAttribute('data-rail-open', open);
      $('#draw-toggle').setAttribute('aria-pressed', String(open));
    });
    doc.defaultView?.matchMedia?.('(prefers-color-scheme: light)').addEventListener(
      'change',
      () => {
        if (!followSystem || disposed) return;
        applyingSystemTheme = true;
        try {
          chart.setTheme(systemThemeId(doc.defaultView));
        } finally {
          applyingSystemTheme = false;
        }
      },
      { signal: abort.signal },
    );
    function choices(selector: string, values: readonly SelectItem[], current: string) {
      const select = $<CfSelectElement>(selector);
      const items = values.some(v => v.value === current)
        ? values
        : [...values, { value: current, label: current }];
      select.setItems(items, current);
      select.disabled = items.length < 2;
    }
    function reflectMarket(state: RuntimeState) {
      const source = markets.find(s => s.id === state.feed.id);
      choices(
        '#source',
        markets.map(s => ({ value: s.id, label: s.label })),
        state.feed.id,
      );
      choices(
        '#symbol',
        (source?.symbols ?? []).map(value => ({ value, label: value.replace('/', ' / ') })),
        state.feed.instrument.symbol,
      );
      const listed = source?.intervals ?? [];
      const custom = source
        ? (customIntervals[source.id] ?? []).filter(i => supportsInterval(source, i))
        : [];
      choices(
        '#interval',
        [...listed, ...custom.filter(i => !listed.includes(i))].map(value => ({
          value,
          label: intervalLabel(value),
          // Time, tick, range and momentum bars each get a heading.
          group: INTERVAL_GROUPS[parseInterval(value).kind],
          ...(listed.includes(value) ? {} : { hint: 'Custom' }),
        })),
        state.feed.interval,
      );
      // Sources that build any length take typed intervals such as 3m or 700t.
      const picker = $<CfSelectElement>('#interval');
      const kinds = source?.customIntervals ?? [];
      picker.custom = kinds.length
        ? text => {
            const interval = parseIntervalInput(text);
            if (!interval || !source || !supportsInterval(source, interval)) return null;
            return { value: interval, label: intervalLabel(interval), hint: 'Custom' };
          }
        : null;
      picker.setAttribute(
        'search-placeholder',
        kinds.length ? `Type ${kinds.map(k => INTERVAL_EXAMPLES[k]).join(', ')}` : 'Search',
      );
      if (kinds.length) picker.disabled = false;
    }
    // The toolbar follows the active chart; `lastState` resets when it changes.
    unsubscribe = chart.subscribe(state => {
      const previous = lastState;
      lastState = state;
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
        const pressed = String(state.document.layers[button.dataset.layer as Layer]);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      }
      set('follow', state.document.viewport.following ? 'Following live' : 'Return to live');
      const autoscale = String(state.document.priceScale.mode === 'auto');
      if ($('#autoscale').getAttribute('aria-pressed') !== autoscale)
        $('#autoscale').setAttribute('aria-pressed', autoscale);
      const type = state.document.chartType ?? 'candles';
      const typeButton = $('#chart-type');
      if (typeButton.dataset.type !== type) {
        typeButton.dataset.type = type;
        typeButton.innerHTML = icon(type);
        typeButton.setAttribute('aria-label', `Chart type: ${chartTypeLabel(type)}`);
      }
      if (
        previous?.document.chartType !== state.document.chartType ||
        previous?.document.footprint !== state.document.footprint
      )
        renderChartTypeMenu?.();
      const log = String(!!state.document.priceScale.log);
      if ($('#log-scale').getAttribute('aria-pressed') !== log)
        $('#log-scale').setAttribute('aria-pressed', log);
      const span = stateTimeScale(state).bars(state.document.viewport.fromMs, state.document.viewport.toMs);
      const allFrom = state.candles.length ? allRange(state).fromMs : 0;
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-bars]')) {
        const selected =
          button.dataset.bars === 'all'
            ? !!state.candles.length && state.document.viewport.fromMs === allFrom
            : Math.abs(span - Number(button.dataset.bars)) < 1e-6;
        const pressed = String(selected);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        button.disabled = !state.candles.length;
      }
      if (
        previous &&
        previous.dataRevision === state.dataRevision &&
        previous.stream === state.stream &&
        previous.paused === state.paused &&
        previous.generation === state.generation
      )
        return;
      if (previous?.feed !== state.feed) reflectMarket(state);
      set('asset-mark', state.feed.instrument.base.slice(0, 1));
      set(
        'feed-state',
        state.paused ? 'Paused' : state.stream.status === 'live' ? 'Connected' : state.stream.status,
      );
      if (previous?.paused !== state.paused) $('#pause').innerHTML = icon(state.paused ? 'play' : 'pause');
      $('#pause').setAttribute('aria-label', state.paused ? 'Resume feed' : 'Pause feed');
      $('#pause').dataset.tooltip = state.paused ? 'Resume feed' : 'Pause feed';
      $('#feed-state').dataset.status = state.paused ? 'paused' : state.stream.status;
    });
    function changeMarket() {
      attempt(() => {
        const source = markets.find(s => s.id === $<CfSelectElement>('#source').value);
        if (!source || !lastState) throw new ChartError('MARKET_SOURCE_UNAVAILABLE');
        const oldSymbol = $<CfSelectElement>('#symbol').value,
          oldInterval = $<CfSelectElement>('#interval').value as Interval;
        if (!source.intervals.includes(oldInterval) && supportsInterval(source, oldInterval))
          rememberCustomInterval(source.id, oldInterval);
        const symbol = source.symbols.includes(oldSymbol)
          ? oldSymbol
          : (source.symbols.find(s => s.split('/')[0] === lastState!.feed.instrument.base) ??
            source.symbols[0]);
        const interval = supportsInterval(source, oldInterval) ? oldInterval : source.intervals[0];
        try {
          setCellMarket(active, { source: source.id, symbol, interval });
        } finally {
          reflectMarket(lastState);
        }
        linkMarkets(active);
      });
    }
    for (const id of ['source', 'symbol', 'interval'])
      $(`#${id}`).addEventListener('change', changeMarket, { signal: abort.signal });
    on('#pause', () => chart.execute({ type: 'feed.pause', paused: !lastState?.paused }));
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-layer]'))
      button.addEventListener(
        'click',
        () =>
          attempt(() => {
            const layer = button.dataset.layer as Layer;
            chart.execute({ type: 'layer.set', layer, visible: !lastState!.document.layers[layer] });
          }),
        { signal: abort.signal },
      );
    on('#indicator-menu', () => {
      openPanel('Indicators', createIndicatorPanel(chart, doc, report).element);
    });
    on('#log-scale', () =>
      chart.execute({ type: 'priceScale.log', enabled: !lastState?.document.priceScale.log }),
    );
    on('#fit', () => {
      chart.execute({ type: 'viewport.reset' });
      chart.execute({ type: 'priceScale.reset' });
    });
    on('#follow', () => chart.execute({ type: 'viewport.reset' }));
    on('#autoscale', () => {
      if (!lastState) return;
      if (lastState.document.priceScale.mode === 'manual') chart.execute({ type: 'priceScale.reset' });
      else {
        // Lock the range currently fitted to the visible candles.
        const { minPrice, maxPrice } = createGeometry(lastState, 1, 1);
        chart.execute({ type: 'priceScale.set', minPrice, maxPrice });
      }
    });
    on('#cursor', () => chart.setTool('cursor'));
    on('#undo', () => chart.execute({ type: 'history.undo' }));
    on('#clear', () => {
      chart.execute({ type: 'drawing.clear' });
      report('Drawings cleared. Undo is available.');
    });
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-bars]'))
      button.addEventListener(
        'click',
        () =>
          attempt(() => {
            const state = lastState!;
            if (!state.candles.length) return;
            chart.execute({
              type: 'viewport.set',
              ...(button.dataset.bars === 'all'
                ? allRange(state)
                : barsRange(state, Number(button.dataset.bars))),
            });
          }),
        { signal: abort.signal },
      );
    const flushAll = () => {
      cells.forEach(flushCell);
      flushWorkspace();
      templates?.flush();
    };
    doc.defaultView?.addEventListener('pagehide', flushAll, { signal: abort.signal });
    doc.addEventListener(
      'visibilitychange',
      () => {
        if (doc.visibilityState === 'hidden') flushAll();
      },
      { signal: abort.signal },
    );
    on('#save', () => {
      void saveCell(active, true);
      if (workspaceReady && (multi() || workspaces.items.length > 1)) void saveWorkspace();
    });
    on('#restore', () => {
      void restoreCell(active);
    });
    on('#export', () => {
      if (!lastState?.candles.length) {
        report('Load a market before exporting.');
        return;
      }
      const content = doc.createElement('div'),
        image = doc.createElement('img'),
        link = doc.createElement('a');
      image.src = chart.capture();
      image.alt = 'Exported market chart';
      link.href = image.src;
      link.download = `candleframe-${lastState.feed.instrument.base}-${lastState.feed.interval}.png`;
      link.className = 'button primary';
      link.textContent = 'Download PNG';
      content.append(image, link);
      openPanel('Export chart', content);
    });
    on('#inspect', () => {
      const pre = doc.createElement('pre');
      pre.textContent = JSON.stringify(
        {
          ...chart.inspect(),
          theme: chart.getTheme(),
          renderer: active.stats,
          layout: { ...layout, active: cells.indexOf(active), charts: cells.map(marketOf) },
        },
        null,
        2,
      );
      openPanel('Chart state', pre);
    });
    on('#chart-type', () => {
      const content = doc.createElement('div');
      content.className = 'layout-menu chart-type-menu';
      const render = () => {
        const state = lastState;
        if (!state) return;
        const focused = shadow.activeElement as HTMLElement | null;
        const focusKey = focused && content.contains(focused) ? focused.dataset.focusKey : undefined;
        const type = state.document.chartType ?? 'candles';
        const options = state.document.footprint ?? FOOTPRINT_DEFAULTS;
        content.replaceChildren();
        const heading = (text: string) => {
          const h = doc.createElement('h3');
          h.textContent = text;
          content.append(h);
        };
        const choices = <T extends string>(
          label: string,
          items: readonly (readonly [T, string])[],
          current: T,
          pick: (value: T) => void,
          disabled = false,
        ) => {
          const group = doc.createElement('div');
          group.className = 'choice-group';
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', label);
          for (const [value, text] of items) {
            const button = doc.createElement('button');
            button.textContent = text;
            button.dataset.focusKey = `${label}:${value}`;
            button.setAttribute('aria-pressed', String(value === current));
            button.disabled = disabled;
            button.addEventListener('click', () => attempt(() => pick(value)));
            group.append(button);
          }
          content.append(group);
        };
        const pickType = (value: ChartType) => {
          const state = lastState!;
          chart.execute({ type: 'chartType.set', chartType: value });
          // Cells need room: zoom a wide view in to the latest bars.
          if (value === 'footprint' && state.candles.length) {
            const scale = stateTimeScale(state);
            const { fromMs, toMs } = state.document.viewport;
            if (scale.bars(fromMs, toMs) > FOOTPRINT_VIEW_BARS * 2) {
              const end = scale.logical(state.candles.at(-1)!.timeMs) + 2;
              chart.execute({
                type: 'viewport.set',
                fromMs: scale.time(end - FOOTPRINT_VIEW_BARS),
                toMs: scale.time(end),
              });
            }
          }
        };
        for (const group of ['Bars', 'Lines', 'Order flow'] as const) {
          heading(group);
          const list = doc.createElement('div');
          list.className = 'chart-type-list';
          list.setAttribute('role', 'group');
          list.setAttribute('aria-label', group);
          for (const item of CHART_TYPES.filter(item => item.group === group)) {
            const button = doc.createElement('button');
            button.innerHTML = `${icon(item.id)}<span>${item.label}</span>`;
            button.dataset.focusKey = `type:${item.id}`;
            button.setAttribute('aria-pressed', String(item.id === type));
            button.addEventListener('click', () => attempt(() => pickType(item.id)));
            list.append(button);
          }
          content.append(list);
        }
        const note = doc.createElement('p');
        note.className = 'chart-type-note';
        const hasCells = state.candles.some(candle => candle.footprint?.length);
        if (type !== 'footprint') {
          // Footprint settings appear once footprints are on.
          note.textContent = hasCells
            ? 'Footprints split each bar into volume at each price.'
            : 'This feed sends no volume at price, so footprints draw as candles.';
          content.append(note);
          if (focusKey) content.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
          return;
        }
        heading('Footprint cells');
        choices(
          'Footprint cells',
          [
            ['bidAsk', 'Bid × Ask'],
            ['delta', 'Delta'],
            ['volume', 'Volume'],
          ] as const,
          options.mode,
          mode =>
            chart.execute({
              type: 'chartType.set',
              chartType: lastState?.document.chartType ?? 'candles',
              footprint: { mode },
            }),
        );
        heading('Show');
        const toggles = doc.createElement('div');
        toggles.className = 'layout-sync';
        for (const [key, text] of [
          ['imbalance', 'Highlight 3:1 imbalances'],
          ['poc', 'Point of control'],
          ['summary', 'Delta and volume'],
        ] as const) {
          const label = doc.createElement('label');
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.dataset.focusKey = `footprint:${key}`;
          input.checked = options[key];
          input.addEventListener('change', () =>
            attempt(() =>
              chart.execute({
                type: 'chartType.set',
                chartType: lastState?.document.chartType ?? 'candles',
                footprint: { [key]: input.checked },
              }),
            ),
          );
          label.append(input, text);
          toggles.append(label);
        }
        content.append(toggles);
        note.textContent = hasCells
          ? 'Zoom in to read cells. Wide views draw candles.'
          : 'This feed sends no volume at price, so its bars draw as candles.';
        content.append(note);
        const restore = focusKey && content.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
        if (restore) restore.focus({ preventScroll: true });
      };
      render();
      openPanel('Chart type', content);
      renderChartTypeMenu = render;
    });
    on('#theme', () => {
      const content = doc.createElement('div');
      const description = doc.createElement('p');
      description.className = 'theme-description';
      description.textContent = 'Choose a preset or customize every visual setting.';
      const themeGrid = doc.createElement('div');
      themeGrid.className = 'theme-grid';
      const current = chart.getTheme();
      for (const theme of Object.values(chartThemes)) {
        const button = doc.createElement('button');
        button.className = 'theme-card';
        button.dataset.theme = theme.id;
        button.setAttribute('aria-label', `${theme.name} theme`);
        button.setAttribute(
          'aria-pressed',
          String(current.id === theme.id && JSON.stringify(current) === JSON.stringify(theme)),
        );
        button.style.setProperty('--preview-bg', theme.palette.background);
        button.style.setProperty('--preview-surface', theme.palette.surface);
        button.style.setProperty('--preview-border', theme.palette.border);
        button.style.setProperty('--preview-up', theme.palette.positive);
        button.style.setProperty('--preview-down', theme.palette.negative);
        button.style.setProperty('--preview-line', theme.palette.indicator);
        button.innerHTML = `<span class="theme-preview" aria-hidden="true"><span class="preview-rail"></span><svg viewBox="0 0 140 66" fill="none"><path class="preview-grid" d="M8 17h124M8 33h124M8 49h124M33 7v52M68 7v52M104 7v52"/><path class="preview-wicks" d="M20 34v20m15-25v20m15-32v26m15-32v23m30-7v23m15-26v25"/><path class="preview-up" d="M20 41v8m15-14v7m15-18v12m15-7v-10m30 22v-7m15 5v-10"/><path class="preview-down-wick" d="M80 17v27M125 22v23"/><path class="preview-down" d="M80 25v12m45-7v9"/><path class="preview-indicator" d="M12 52c15 0 28-22 45-23s23 14 39 12 19-11 37-9"/></svg><span class="theme-check">${icon('check', 14)}</span></span><span class="theme-card-label"><strong>${theme.name}</strong><small>${theme.mode === 'light' ? 'Light' : 'Dark'}</small></span>`;
        button.addEventListener('click', () => attempt(() => chart.setTheme(theme.id as ThemeInput)), {
          signal: abort.signal,
        });
        themeGrid.append(button);
      }
      themeEditor?.dispose();
      themeEditor = createThemeEditor(chart, doc);
      content.append(description, themeGrid, themeEditor.element);
      openPanel('Appearance', content);
    });
    on('#layout', () => {
      const content = doc.createElement('div');
      content.className = 'layout-menu';
      // Rows being renamed keep their input across re-renders.
      let renaming: string | null = null;
      const render = () => {
        const focused = shadow.activeElement as HTMLElement | null;
        const focusKey = focused && content.contains(focused) ? focused.dataset.focusKey : undefined;
        content.replaceChildren();
        const heading = (text: string) => {
          const h = doc.createElement('h3');
          h.textContent = text;
          content.append(h);
        };
        heading('Grid');
        const presets = doc.createElement('div');
        presets.className = 'layout-presets';
        presets.setAttribute('role', 'group');
        presets.setAttribute('aria-label', 'Grid');
        for (const [id, preset] of Object.entries(LAYOUT_PRESETS) as [
          LayoutPreset,
          (typeof LAYOUT_PRESETS)[LayoutPreset],
        ][]) {
          const button = doc.createElement('button');
          button.className = 'layout-preset';
          button.dataset.preset = id;
          button.dataset.focusKey = `preset:${id}`;
          button.setAttribute('aria-label', preset.label);
          button.setAttribute('aria-pressed', String(layout.preset === id));
          button.dataset.tooltip = preset.label;
          button.disabled = preset.cells > 1 && !markets.length;
          const glyph = doc.createElement('span');
          glyph.className = 'layout-glyph';
          glyph.dataset.preset = id;
          glyph.style.gridTemplateColumns = `repeat(${preset.columns}, 1fr)`;
          glyph.style.gridTemplateRows = `repeat(${preset.rows}, 1fr)`;
          glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = '<i></i>'.repeat(preset.cells);
          button.append(glyph);
          button.addEventListener('click', () =>
            attempt(() => {
              applyPreset(id);
              scheduleWorkspaceSave();
            }),
          );
          presets.append(button);
        }
        content.append(presets);
        heading('Sync in layout');
        const sync = doc.createElement('div');
        sync.className = 'layout-sync';
        for (const key of Object.keys(SYNC_LABELS) as (keyof WidgetSync)[]) {
          const label = doc.createElement('label');
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.dataset.sync = key;
          input.dataset.focusKey = `sync:${key}`;
          // A shared date range already aligns time.
          input.checked = layout.sync[key] || (key === 'time' && layout.sync.dateRange);
          input.disabled = key === 'time' && layout.sync.dateRange;
          input.addEventListener('change', () =>
            attempt(() => {
              updateSync({ [key]: input.checked });
              scheduleWorkspaceSave();
            }),
          );
          label.append(input, SYNC_LABELS[key]);
          sync.append(label);
        }
        content.append(sync);
        heading('Saved layouts');
        const list = doc.createElement('ul');
        list.className = 'layout-list';
        for (const item of workspaces.items) {
          const row = doc.createElement('li');
          if (renaming === item.id) {
            const form = doc.createElement('form');
            form.className = 'layout-rename';
            const input = doc.createElement('input');
            input.value = item.name;
            input.maxLength = 60;
            input.setAttribute('aria-label', `Rename ${item.name}`);
            input.dataset.focusKey = `rename:${item.id}`;
            const ok = doc.createElement('button');
            ok.type = 'submit';
            ok.className = 'button';
            ok.textContent = 'Rename';
            form.append(input, ok);
            form.addEventListener('submit', event => {
              event.preventDefault();
              attempt(() => {
                renameWorkspace(item.id, input.value);
                renaming = null;
                render();
              });
            });
            input.addEventListener('keydown', event => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              renaming = null;
              render();
            });
            row.append(form);
            queueMicrotask(() => input.isConnected && input.focus({ preventScroll: true }));
          } else {
            const open = doc.createElement('button');
            open.className = 'layout-open';
            open.textContent = item.name;
            open.dataset.focusKey = `open:${item.id}`;
            open.setAttribute('aria-current', String(item.id === workspaces.current));
            open.addEventListener('click', () => void switchWorkspace(item.id));
            const rename = doc.createElement('button');
            rename.className = 'icon-button';
            rename.innerHTML = icon('edit', 16);
            rename.setAttribute('aria-label', `Rename ${item.name}`);
            rename.dataset.tooltip = 'Rename';
            rename.addEventListener('click', () => {
              renaming = item.id;
              render();
            });
            const remove = doc.createElement('button');
            remove.className = 'icon-button';
            remove.innerHTML = icon('trash', 16);
            remove.setAttribute('aria-label', `Delete ${item.name}`);
            remove.dataset.tooltip = 'Delete';
            remove.disabled = workspaces.items.length < 2;
            remove.addEventListener('click', () => {
              deleteWorkspace(item.id).catch(error => report(String(error)));
            });
            row.append(open, rename, remove);
          }
          list.append(row);
        }
        content.append(list);
        const form = doc.createElement('form');
        form.className = 'layout-save-as';
        const name = doc.createElement('input');
        name.placeholder = 'New layout name';
        name.maxLength = 60;
        name.setAttribute('aria-label', 'New layout name');
        name.dataset.focusKey = 'save-as';
        const submit = doc.createElement('button');
        submit.type = 'submit';
        submit.className = 'button primary';
        submit.textContent = 'Save as new';
        form.append(name, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          saveWorkspaceAs(name.value).catch(error =>
            report(error instanceof Error ? error.message : String(error)),
          );
        });
        content.append(form);
        const note = doc.createElement('p');
        note.className = 'layout-note';
        note.textContent = multi()
          ? 'Click a chart or press Alt + 1 to 8 to choose the one the toolbar controls.'
          : 'Drawings belong to each market, so layouts showing the same market share them.';
        content.append(note);
        if (focusKey) content.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
      };
      render();
      const pressed = content.querySelector<HTMLElement>('.layout-preset[aria-pressed=true]');
      pressed?.setAttribute('data-autofocus', '');
      openPanel('Layout', content);
      renderLayoutMenu = render;
    });
    on('#help', () => {
      const content = doc.createElement('div');
      const gridRow = markets.length ? '<dt>Alt + 1 to 8</dt><dd>Choose a chart in a grid layout.</dd>' : '';
      const saving = options.storageKey
        ? "Drawings and settings save as you work, per source, symbol and interval. An interval change keeps a drawing's anchors."
        : 'Drawings and settings last until the page reloads.';
      content.innerHTML = `<p>Drag the plot to pan time and price. Drag either axis to resize it; double-click to reset. Scroll over the chart to zoom.</p><dl class="shortcuts"><dt>Drawing tools</dt><dd>Choose a category on the left. Click anchors or drag freehand. Enter finishes a polyline.</dd><dt>Objects</dt><dd>Edit text, styles, coordinates, Fibonacci levels, visibility and locks.</dd><dt>Ctrl / ⌘ Z</dt><dd>Undo. Shift + Ctrl / ⌘ Z redoes.</dd><dt>Ctrl / ⌘ C, V, D</dt><dd>Copy, paste or duplicate a selected drawing.</dd><dt>Delete</dt><dd>Delete the selected unlocked drawing.</dd><dt>Escape</dt><dd>Cancel drawing or close this panel.</dd><dt>Home / + / −</dt><dd>Return to live / zoom in / zoom out.</dd>${gridRow}</dl><p>${saving}</p>`;
      const button = doc.createElement('button');
      button.className = 'button';
      button.textContent = 'Accessible candle data';
      button.addEventListener(
        'click',
        () => {
          const table = doc.createElement('table');
          table.className = 'candle-table';
          table.innerHTML =
            '<caption>Latest 8 candles · UTC</caption><thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th></tr></thead><tbody></tbody>';
          for (const bar of lastState?.candles.slice(-8).reverse() ?? []) {
            const row = doc.createElement('tr');
            for (const value of [
              active.timeFormats.full(bar.timeMs),
              ...[bar.open, bar.high, bar.low, bar.close].map(p => active.price.format(p)),
            ]) {
              const cell = doc.createElement('td');
              cell.textContent = value;
              row.append(cell);
            }
            table.querySelector('tbody')!.append(row);
          }
          openPanel('Candle data', table);
        },
        { signal: abort.signal },
      );
      content.append(button);
      openPanel('Chart controls', content);
    });
    if (layout.preset !== '1') applyPreset(layout.preset);
    else renderGrid();
    void loadWorkspaces();
    const api: ChartWidgetApi = {
      ...chart,
      charts: () => cells.map(cell => cell.chart),
      getActiveChart: () => cells.indexOf(active),
      setActiveChart(index) {
        const cell = cells[index];
        if (!cell) throw new ChartError('INVALID_CHART_INDEX', undefined, { details: { index } });
        activate(cell);
      },
      getLayout: () => structuredClone(layout),
      setLayout(next) {
        if (next.preset !== undefined) {
          if (!isLayoutPreset(next.preset))
            throw new ChartError('INVALID_LAYOUT_PRESET', undefined, {
              path: 'preset',
              details: { allowed: Object.keys(LAYOUT_PRESETS) },
            });
          applyPreset(next.preset);
        }
        if (next.sync) updateSync(next.sync);
        scheduleWorkspaceSave();
      },
      dispose() {
        if (disposed) return;
        flushAll();
        disposed = true;
        abort.abort();
        clearTimeout(toastTimer);
        clearTimeout(workspaceTimer);
        unsubscribe();
        themeEditor?.dispose();
        workbench?.dispose();
        group.dispose();
        for (const cell of cells) {
          clearTimeout(cell.saveTimer);
          cell.unsubscribe();
          cell.chart.dispose();
        }
        cells.length = 0;
        sessionLayouts.clear();
        mount.remove();
      },
    };
    return api;
  } catch (error) {
    disposed = true;
    abort.abort();
    clearTimeout(toastTimer);
    unsubscribe();
    themeEditor?.dispose();
    workbench?.dispose();
    group.dispose();
    for (const cell of cells) {
      clearTimeout(cell.saveTimer);
      cell.unsubscribe();
      cell.chart.dispose();
    }
    mount.remove();
    throw error;
  }
}
