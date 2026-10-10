import { loadWidgetFonts } from './widget-fonts.ts';
import { chartThemes, resolveTheme } from './themes.ts';
import type { ThemeInput } from './themes.ts';
import { applyWidgetTheme } from './widget-theme.ts';
import { createThemeEditor } from './theme-editor.ts';
import { createChart } from './chart.ts';
import type { ChartApi, ChartOptions } from './chart.ts';
import { createDrawingWorkbench } from './drawing-workbench.ts';
import { drawingWorkbenchStyles } from './drawing-workbench-style.ts';
import { uiIcon as icon } from './ui-icons.ts';
import { widgetStyles } from './widget-style.ts';
import { resolveMarketFeed, validateMarketSources } from './widget-market.ts';
import type { WidgetMarketSource } from './widget-market.ts';
import type { Candle, ChartDocument, Interval, Layer, RuntimeState } from './types.ts';
import type { RendererStats } from './webgl-renderer.ts';

export type { WidgetMarketSource } from './widget-market.ts';
export interface WidgetLayoutStore {
  load(key: string): unknown | Promise<unknown>;
  save(key: string, document: ChartDocument): void | Promise<void>;
}
export interface ChartWidgetOptions extends ChartOptions {
  /** Factories return disconnected adapters; the selected adapter owns its connection. */
  markets?: readonly WidgetMarketSource[];
  orderBook?: boolean;
  /** Enables browser persistence in this namespace. Omit for instance-local session saves. */
  storageKey?: string;
  /** Optional application storage. Requires a storageKey namespace. */
  layoutStore?: WidgetLayoutStore;
}

/** A complete, instance-isolated workbench. Only the host element's size is required. */
export function createChartWidget(container: HTMLElement, options: ChartWidgetOptions): ChartApi {
  const markets = options.markets ?? [];
  validateMarketSources(markets);
  if (options.layoutStore && !options.storageKey?.trim()) throw new Error('WIDGET_STORAGE_KEY_REQUIRED');
  const doc = container.ownerDocument,
    mount = doc.createElement('div');
  const themeKey = options.storageKey ? JSON.stringify([options.storageKey, 'appearance']) : null;
  let initialTheme = resolveTheme(options.theme);
  if (!options.theme && themeKey) {
    try {
      const saved = doc.defaultView?.localStorage.getItem(themeKey);
      if (saved) initialTheme = resolveTheme(JSON.parse(saved));
    } catch {
      /* Invalid or unavailable storage leaves the default theme intact. */
    }
  }
  applyWidgetTheme(mount, initialTheme);
  loadWidgetFonts(doc);
  mount.className = 'openchart-widget';
  Object.assign(mount.style, { width: '100%', height: '100%', minWidth: '0', minHeight: '0' });
  const shadow = mount.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = widgetStyles + drawingWorkbenchStyles;
  const root = doc.createElement('section');
  root.className = 'widget';
  root.setAttribute('aria-label', 'Chart widget');
  root.innerHTML = `<header class="widget-header">
    <div class="market-controls"><span class="asset-mark" id="asset-mark" aria-hidden="true">B</span><select id="symbol" class="symbol-picker" aria-label="Symbol"></select><span class="toolbar-divider"></span><select id="interval" class="interval-picker" aria-label="Candle interval"></select></div>
    <div class="analysis-controls"><button data-layer="indicator" aria-label="Toggle indicators" aria-pressed="true" data-tooltip="Indicators">${icon('indicators')}<span>Indicators</span></button><button data-layer="volume" aria-label="Toggle volume" aria-pressed="true" data-tooltip="Volume">${icon('volume')}<span>Volume</span></button></div>
    <div class="widget-actions"><button id="book-toggle" aria-label="Toggle order book" aria-pressed="false" data-tooltip="Order book">${icon('book')}<span>Order book</span></button><span class="toolbar-divider"></span><button id="pause" class="icon-button" aria-label="Pause feed" data-tooltip="Pause feed">${icon('pause')}</button><button id="save" class="save-button" aria-label="Save layout" data-tooltip="Save layout">${icon('save', 18)}<span>Save</span></button><button id="restore" class="icon-button" aria-label="Restore layout" data-tooltip="Restore layout">${icon('restore')}</button><button id="theme" class="icon-button" aria-label="Chart appearance" data-tooltip="Appearance">${icon('palette')}</button><button id="export" class="icon-button" aria-label="Export PNG" data-tooltip="Export image">${icon('camera')}</button></div>
  </header>
  <div class="widget-body"><aside class="tool-rail" aria-label="Drawing tools"><button id="cursor" class="rail-button active" aria-label="Cursor tool" data-tooltip="Cursor">${icon('cursor')}</button><span class="rail-separator"></span><button id="trend" class="rail-button">${icon('trendline')}</button><span class="rail-separator"></span><button id="undo" class="rail-button" aria-label="Undo last edit" data-tooltip="Undo · ⌘ / Ctrl Z">${icon('undo')}</button><button id="clear" class="rail-button" aria-label="Clear drawings" data-tooltip="Clear drawings">${icon('trash')}</button><button id="fit" class="rail-button" aria-label="Fit chart to live data" data-tooltip="Fit chart">${icon('fit')}</button><button id="help" class="rail-button rail-bottom" aria-label="Chart controls and shortcuts" data-tooltip="Help & shortcuts">${icon('help')}</button></aside>
  <section class="chart-panel" aria-label="Price chart"><div class="chart-toolbar"><div class="market-summary"><span class="market-name" id="market-name"></span><span class="market-kind" id="market-kind"></span><span class="price-heading">Last price</span><strong id="price" class="market-price">—</strong></div><div class="ohlc-values"><span>O <b id="open-value">—</b></span><span>H <b id="high-value">—</b></span><span>L <b id="low-value">—</b></span><span>C <b id="close-value">—</b></span><span class="hover-time" id="hover-time">Latest candle</span></div><div class="chart-legend"><span class="legend-indicator"><i></i><span id="indicator-name"></span></span><span class="legend-volume">Volume</span></div></div><div class="connection-notice" hidden><span id="connection-message"></span><button id="retry">Reconnect</button></div><div id="chart-host"></div></section>
  <aside class="book-panel" aria-label="Live order book" hidden><div class="panel-title"><h2>Order book</h2><div><span id="book-state" class="book-badge"></span><button id="book-close" class="icon-button" aria-label="Close order book">${icon('close', 16)}</button></div></div><div class="book-subtitle"><span id="book-coverage"></span><span id="book-tick"></span></div><div class="book-columns"><span>Price <small id="book-quote"></small></span><span>Size <small id="book-base"></small></span><span>Total</span></div><div id="asks" class="book-side asks"></div><div class="spread-row"><strong id="book-price">—</strong><span>Spread <b id="spread">—</b></span></div><div id="bids" class="book-side bids"></div><p class="book-note" id="book-note"></p></aside></div>
  <footer class="widget-footer"><div class="range-buttons" aria-label="Visible candle count"><button data-bars="60">60</button><button data-bars="180">180</button><button data-bars="360">360</button><button data-bars="all">All</button></div><span class="footer-divider"></span><select id="source" class="source-picker" aria-label="Data source"></select><span class="feed-state" id="feed-state"></span><button class="follow-button" id="follow">Following live</button><button id="inspect" class="icon-button" aria-label="Inspect state" data-tooltip="Inspect chart state">${icon('code', 16)}</button><span class="wordmark">OpenChart<span> / </span></span></footer>
  <div class="widget-tooltip" role="tooltip" hidden></div><div class="widget-toast" role="status" hidden></div><section class="widget-dialog" role="dialog" aria-label="Chart panel" hidden><header class="dialog-heading"><h2></h2><button class="icon-button" aria-label="Close dialog">${icon('close')}</button></header><div class="dialog-content"></div></section>`;
  shadow.append(style, root);
  container.append(mount);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const set = (id: string, text: string) => {
    const el = $(`#${id}`);
    if (el.textContent !== text) el.textContent = text;
  };
  const abort = new AbortController();
  let disposed = false,
    toastTimer: ReturnType<typeof setTimeout> | undefined;
  let lastState: RuntimeState | undefined,
    latestStats: RendererStats | undefined,
    hovering = false;
  let price = new Intl.NumberFormat('en-US'),
    quantity = new Intl.NumberFormat('en-US');
  const time = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
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
  function openPanel(title: string, content: HTMLElement) {
    if (themeEditor && !content.contains(themeEditor.element)) {
      themeEditor.dispose();
      themeEditor = undefined;
    }
    if (popup.hidden) popupFocus = shadow.activeElement as HTMLElement | null;
    popup.classList.toggle('theme-dialog', title === 'Appearance');
    popup.querySelector('h2')!.textContent = title;
    popup.setAttribute('aria-label', title);
    popupContent.replaceChildren(content);
    popup.hidden = false;
    popup.querySelector('button')!.focus({ preventScroll: true });
  }
  function closePanel() {
    themeEditor?.dispose();
    themeEditor = undefined;
    popup.hidden = true;
    if (popup.contains(shadow.activeElement)) popupFocus?.focus({ preventScroll: true });
  }
  popup.querySelector('button')!.addEventListener('click', closePanel, { signal: abort.signal });
  root.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && !popup.hidden) {
        event.stopPropagation();
        closePanel();
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
    if (!control?.dataset.tooltip || control.matches(':disabled')) return;
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
  function showCandle(bar: Candle | null | undefined) {
    for (const field of ['open', 'high', 'low', 'close'] as const)
      set(`${field}-value`, bar ? price.format(bar[field]) : '—');
  }
  let workbench: ReturnType<typeof createDrawingWorkbench> | undefined;
  let chart: ChartApi;
  try {
    chart = createChart($('#chart-host'), {
      ...options,
      theme: initialTheme,
      onThemeChange(theme) {
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
        if (themeKey) {
          try {
            doc.defaultView?.localStorage.setItem(themeKey, JSON.stringify(theme));
          } catch {
            /* Theme changes still work when browser storage is unavailable. */
          }
        }
        options.onThemeChange?.(theme);
      },
      onDrawingChange(value) {
        workbench?.interaction(value);
        options.onDrawingChange?.(value);
      },
      onDrawingEdit(value) {
        closePanel();
        workbench?.editDrawing(value);
        options.onDrawingEdit?.(value);
      },
      onError(error) {
        report(error.message);
        options.onError?.(error);
      },
      onHover(bar) {
        hovering = !!bar;
        showCandle(bar ?? lastState?.candles.at(-1));
        set('hover-time', bar ? `${time.format(bar.timeMs)} UTC` : 'Latest candle');
        options.onHover?.(bar);
      },
      onStats(stats) {
        latestStats = stats;
        options.onStats?.(stats);
      },
    });
  } catch (error) {
    abort.abort();
    clearTimeout(toastTimer);
    mount.remove();
    throw error;
  }
  let unsubscribe = () => {};
  let bookResize: ResizeObserver | undefined;
  try {
    workbench = createDrawingWorkbench(chart, {
      root,
      rail: $('.tool-rail'),
      panel: $('.chart-panel'),
      report,
    });
    // Stable styling hooks for host-specific chrome beyond the shared canvas theme.
    for (const [selector, part] of Object.entries({
      '.widget': 'widget',
      '.widget-header': 'toolbar',
      '.tool-rail': 'drawing-toolbar',
      '.chart-panel': 'chart-panel',
      '.chart-toolbar': 'chart-summary',
      '.book-panel': 'order-book',
      '.widget-footer': 'footer',
      '.widget-dialog': 'dialog',
      '.drawing-strip': 'drawing-controls',
      '.drawing-flyout': 'drawing-menu',
      '.drawing-object-panel': 'drawing-properties',
      '.drawing-text-editor': 'text-editor',
    })) {
      (root.matches(selector) ? root : root.querySelector(selector))?.setAttribute('part', part);
    }
    const book = $('.book-panel');
    book.hidden = !options.orderBook || mount.clientWidth <= 850;
    $('#book-toggle').setAttribute('aria-pressed', String(!book.hidden));
    const makeRows = (id: string) =>
      Array.from({ length: 11 }, () => {
        const row = doc.createElement('div');
        row.className = 'book-row';
        row.innerHTML = '<span></span><span></span><span></span>';
        $(`#${id}`).append(row);
        return row;
      });
    const askRows = makeRows('asks'),
      bidRows = makeRows('bids');
    let visibleBookRows = 11;
    function updateBook(state: RuntimeState) {
      if (book.hidden) return;
      const live = !state.paused && state.streams.depth.status === 'live';
      book.classList.toggle('stale-book', !live);
      set('book-state', state.paused ? 'PAUSED' : state.streams.depth.status.toUpperCase());
      set(
        'book-coverage',
        `${state.feed.depth.kind === 'snapshots' ? 'Top ' : ''}${state.feed.depth.levels} levels / side`,
      );
      set('book-tick', `${price.format(state.feed.instrument.tickSize)} tick`);
      set('book-quote', state.feed.instrument.quote);
      set('book-base', state.feed.instrument.base);
      set('book-note', `${state.feed.instrument.quote} price · ${state.feed.instrument.base} quantity`);
      const totals = (levels: RuntimeState['book']['bids']) => {
        let total = 0;
        return levels.slice(0, visibleBookRows).map(([p, q]) => ({ p, q, total: (total += q) }));
      };
      const bids = totals(state.book.bids),
        asks = totals(state.book.asks),
        max = Math.max(1, bids.at(-1)?.total ?? 0, asks.at(-1)?.total ?? 0);
      for (const [rows, values] of [
        [bidRows, bids],
        [askRows, [...asks].reverse()],
      ] as const)
        rows.forEach((row, i) => {
          row.hidden = i >= visibleBookRows;
          const entry = values[i],
            formatted = entry
              ? [price.format(entry.p), quantity.format(entry.q), quantity.format(entry.total)]
              : ['—', '—', '—'];
          [...row.children].forEach((cell, j) => {
            if (cell.textContent !== formatted[j]) cell.textContent = formatted[j];
          });
          row.style.setProperty('--depth', `${entry ? (entry.total / max) * 100 : 0}%`);
        });
      set('book-price', bids.length && asks.length ? price.format((bids[0].p + asks[0].p) / 2) : '—');
      set('spread', live && bids.length && asks.length ? price.format(asks[0].p - bids[0].p) : '—');
    }
    // Keep complete rows on both sides of the midpoint without reading layout on each tick.
    bookResize = new ResizeObserver(() => {
      const height = Math.min($('#asks').clientHeight, $('#bids').clientHeight);
      if (!height) return;
      const rowHeight = askRows[0].getBoundingClientRect().height;
      if (!rowHeight) return;
      const padding = Number.parseFloat(doc.defaultView!.getComputedStyle($('#asks')).paddingTop) || 0;
      const count = Math.max(1, Math.min(11, Math.floor((height - padding) / rowHeight)));
      if (count !== visibleBookRows) {
        visibleBookRows = count;
        if (lastState) updateBook(lastState);
      }
    });
    bookResize.observe($('#asks'));
    bookResize.observe($('#bids'));
    bookResize.observe(askRows[0]);
    function choices(selector: string, values: readonly { value: string; label: string }[], current: string) {
      const select = $<HTMLSelectElement>(selector);
      select.replaceChildren();
      for (const value of values) {
        const option = doc.createElement('option');
        option.value = value.value;
        option.textContent = value.label;
        select.append(option);
      }
      if (!values.some(v => v.value === current)) {
        const option = doc.createElement('option');
        option.value = current;
        option.textContent = current;
        select.append(option);
      }
      select.value = current;
      select.disabled = select.options.length < 2;
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
      choices(
        '#interval',
        (source?.intervals ?? []).map(value => ({ value, label: value })),
        state.feed.interval,
      );
    }
    unsubscribe = chart.subscribe(state => {
      const previous = lastState;
      lastState = state;
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
        const pressed = String(state.document.layers[button.dataset.layer as Layer]);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      }
      set('follow', state.document.viewport.following ? 'Following live' : 'Return to live');
      $('.legend-indicator').hidden = !state.document.layers.indicator || !options.indicators?.length;
      $('.legend-volume').hidden = !state.document.layers.volume;
      const span = state.document.viewport.toMs - state.document.viewport.fromMs;
      const allFrom = state.candles.length
        ? Math.min(state.candles[0].timeMs, state.candles.at(-1)!.timeMs - 8 * state.feed.intervalMs)
        : 0;
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-bars]')) {
        const selected =
          button.dataset.bars === 'all'
            ? !!state.candles.length && state.document.viewport.fromMs === allFrom
            : Math.abs(span - Number(button.dataset.bars) * state.feed.intervalMs) < 1;
        const pressed = String(selected);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        button.disabled = !state.candles.length;
      }
      if (
        previous &&
        previous.dataRevision === state.dataRevision &&
        previous.streams === state.streams &&
        previous.paused === state.paused &&
        previous.generation === state.generation
      )
        return;
      if (previous?.feed !== state.feed) {
        price = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: state.feed.instrument.pricePrecision,
          maximumFractionDigits: state.feed.instrument.pricePrecision,
        });
        quantity = new Intl.NumberFormat('en-US', {
          maximumFractionDigits: Math.min(6, state.feed.instrument.quantityPrecision),
        });
        reflectMarket(state);
      }
      if (previous?.generation !== state.generation) hovering = false;
      const names: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };
      set('market-name', names[state.feed.instrument.base] ?? state.feed.instrument.base);
      set('asset-mark', state.feed.instrument.base.slice(0, 1));
      set('market-kind', state.feed.simulated ? 'Simulated market' : 'Spot market');
      set('price', state.candles.length ? price.format(state.candles.at(-1)!.close) : '—');
      if (!hovering) showCandle(state.candles.at(-1));
      set(
        'feed-state',
        state.paused
          ? 'Paused'
          : state.streams.candles.status === 'live'
            ? 'Connected'
            : state.streams.candles.status,
      );
      if (previous?.paused !== state.paused) $('#pause').innerHTML = icon(state.paused ? 'play' : 'pause');
      $('#pause').setAttribute('aria-label', state.paused ? 'Resume feed' : 'Pause feed');
      $('#pause').dataset.tooltip = state.paused ? 'Resume feed' : 'Pause feed';
      $('#feed-state').dataset.status = state.paused ? 'paused' : state.streams.candles.status;
      const issues = (['candles', 'depth'] as const).filter(stream =>
        ['error', 'stale'].includes(state.streams[stream].status),
      );
      $('.connection-notice').hidden = !issues.length;
      set(
        'connection-message',
        issues
          .map(stream => `${stream}: ${state.streams[stream].message ?? state.streams[stream].status}`)
          .join(' · '),
      );
      updateBook(state);
    });
    function changeMarket() {
      attempt(() => {
        const source = markets.find(s => s.id === $<HTMLSelectElement>('#source').value);
        if (!source || !lastState) throw new Error('MARKET_SOURCE_UNAVAILABLE');
        const oldSymbol = $<HTMLSelectElement>('#symbol').value,
          oldInterval = $<HTMLSelectElement>('#interval').value as Interval;
        const symbol = source.symbols.includes(oldSymbol)
          ? oldSymbol
          : (source.symbols.find(s => s.split('/')[0] === lastState!.feed.instrument.base) ??
            source.symbols[0]);
        const interval = source.intervals.includes(oldInterval) ? oldInterval : source.intervals[0];
        try {
          chart.replaceFeed(resolveMarketFeed(source, { symbol, interval }));
        } finally {
          reflectMarket(lastState);
        }
      });
    }
    for (const id of ['source', 'symbol', 'interval'])
      $(`#${id}`).addEventListener('change', changeMarket, { signal: abort.signal });
    const on = (selector: string, action: () => void) =>
      $(selector).addEventListener('click', () => attempt(action), { signal: abort.signal });
    on('#retry', () => {
      chart.execute({ type: 'feed.pause', paused: true });
      chart.execute({ type: 'feed.pause', paused: false });
    });
    on('#pause', () => chart.execute({ type: 'feed.pause', paused: !lastState?.paused }));
    function toggleBook() {
      book.hidden = !book.hidden;
      $('#book-toggle').setAttribute('aria-pressed', String(!book.hidden));
      if (lastState) updateBook(lastState);
    }
    on('#book-toggle', toggleBook);
    on('#book-close', toggleBook);
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
    if (!options.indicators?.length) $<HTMLButtonElement>('[data-layer="indicator"]').hidden = true;
    else set('indicator-name', options.indicators.map(p => p.name).join(' · '));
    on('#fit', () => {
      chart.execute({ type: 'viewport.reset' });
      chart.execute({ type: 'priceScale.reset' });
    });
    on('#follow', () => chart.execute({ type: 'viewport.reset' }));
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
            const end = state.candles.at(-1)!.timeMs + 12 * state.feed.intervalMs;
            const from =
              button.dataset.bars === 'all'
                ? Math.min(state.candles[0].timeMs, end - 20 * state.feed.intervalMs)
                : end - Number(button.dataset.bars) * state.feed.intervalMs;
            chart.execute({ type: 'viewport.set', fromMs: from, toMs: end });
          }),
        { signal: abort.signal },
      );
    const sessionLayouts = new Map<string, ChartDocument>();
    const store: WidgetLayoutStore =
      options.layoutStore ??
      (options.storageKey
        ? {
            load: key => {
              const saved = doc.defaultView!.localStorage.getItem(key);
              return saved === null ? null : JSON.parse(saved);
            },
            save: (key, value) => doc.defaultView!.localStorage.setItem(key, JSON.stringify(value)),
          }
        : {
            load: key => sessionLayouts.get(key),
            save: (key, value) => {
              sessionLayouts.set(key, structuredClone(value));
            },
          });
    const layoutKey = () =>
      JSON.stringify([
        options.storageKey ?? 'session',
        lastState!.feed.id,
        lastState!.feed.instrument.symbol,
        lastState!.feed.interval,
      ]);
    async function save() {
      try {
        await store.save(layoutKey(), chart.exportDocument());
        report(options.storageKey ? 'Layout saved.' : 'Layout saved for this widget session.');
      } catch (error) {
        report(`Could not save layout: ${String(error)}`);
      }
    }
    async function restore() {
      const before = chart.inspect();
      try {
        const saved = await store.load(layoutKey());
        if (disposed) return;
        if (saved === null || saved === undefined) {
          report('No saved layout for this market.');
          return;
        }
        if (chart.inspect().generation !== before.generation)
          throw new Error('MARKET_CHANGED_DURING_RESTORE');
        chart.restoreDocument(saved, before.documentRevision);
        report('Layout restored.');
      } catch (error) {
        report(`Could not restore layout: ${String(error)}`);
      }
    }
    on('#save', () => {
      void save();
    });
    on('#restore', () => {
      void restore();
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
      link.download = `openchart-${lastState.feed.instrument.base}-${lastState.feed.interval}.png`;
      link.className = 'button primary';
      link.textContent = 'Download PNG';
      content.append(image, link);
      openPanel('Export chart', content);
    });
    on('#inspect', () => {
      const pre = doc.createElement('pre');
      pre.textContent = JSON.stringify(
        { ...chart.inspect(), theme: chart.getTheme(), renderer: latestStats },
        null,
        2,
      );
      openPanel('Chart state', pre);
    });
    on('#theme', () => {
      const content = doc.createElement('div');
      const description = doc.createElement('p');
      description.className = 'theme-description';
      description.textContent = 'Choose a preset or customize every visual setting.';
      const grid = doc.createElement('div');
      grid.className = 'theme-grid';
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
        grid.append(button);
      }
      themeEditor?.dispose();
      themeEditor = createThemeEditor(chart, doc);
      content.append(description, grid, themeEditor.element);
      openPanel('Appearance', content);
    });
    on('#help', () => {
      const content = doc.createElement('div');
      content.innerHTML =
        '<p>Drag the plot to pan time and price. Drag either axis to resize it; double-click to reset. Scroll over the chart to zoom.</p><dl class="shortcuts"><dt>Drawing tools</dt><dd>Choose a category on the left. Click anchors or drag freehand. Enter finishes a polyline.</dd><dt>Objects</dt><dd>Edit text, styles, coordinates, Fibonacci levels, visibility and locks.</dd><dt>Ctrl / ⌘ Z</dt><dd>Undo. Shift + Ctrl / ⌘ Z redoes.</dd><dt>Ctrl / ⌘ C, V, D</dt><dd>Copy, paste or duplicate a selected drawing.</dd><dt>Delete</dt><dd>Delete the selected unlocked drawing.</dd><dt>Escape</dt><dd>Cancel drawing or close this panel.</dd><dt>Home / + / −</dt><dd>Return to live / zoom in / zoom out.</dd></dl><p>Save and Load apply to the selected source, symbol and interval. A source or symbol change clears drawings. An interval change preserves anchors.</p>';
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
              time.format(bar.timeMs),
              ...[bar.open, bar.high, bar.low, bar.close].map(p => price.format(p)),
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
    return {
      ...chart,
      dispose() {
        if (disposed) return;
        disposed = true;
        abort.abort();
        clearTimeout(toastTimer);
        unsubscribe();
        bookResize?.disconnect();
        themeEditor?.dispose();
        workbench?.dispose();
        chart.dispose();
        sessionLayouts.clear();
        mount.remove();
      },
    };
  } catch (error) {
    disposed = true;
    abort.abort();
    clearTimeout(toastTimer);
    unsubscribe();
    bookResize?.disconnect();
    themeEditor?.dispose();
    workbench?.dispose();
    chart.dispose();
    mount.remove();
    throw error;
  }
}
