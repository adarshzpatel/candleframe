import type { ChartApi } from './chart.ts';
import type { ChartMarker, PriceLine } from './chart-overlays.ts';
import { themeColor } from './themes.ts';
import {
  describeOrder,
  entryTypeAt,
  exitResizes,
  exitAt,
  formatPnl,
  pnlAt,
  positionEffect,
  positionOf,
} from './trading-logic.ts';
import type { BrokerAdapter, BrokerOrder, BrokerState, OrderRequest, OrderResult } from './trading-types.ts';
import {
  confirmTicket,
  createOrderPanel,
  notify,
  showMenu,
  TRADING_STYLE,
  type TicketText,
} from './trading-ui.ts';

export interface TradingOptions {
  broker: BrokerAdapter;
  /** The element the charts fill. The panel floats over it and it takes right-clicks. */
  host: HTMLElement;
  /** Show a confirm ticket before every order. Default true. */
  confirm?: boolean;
  /** The account to start with; otherwise the last one chosen, then the first. */
  account?: string;
  /** Namespace for the panel position, account and Trading switch in browser storage. */
  storageKey?: string;
  /**
   * Keep a single TP and a single SL sized to the whole position as it grows or shrinks.
   * Default true; it acts only while Trading is on.
   */
  syncExits?: boolean;
}

export interface TradingLayer {
  /** Turns the confirm ticket on or off. */
  setConfirm(confirm: boolean): void;
  dispose(): void;
}

/** The charts the layer draws on: a widget's grid, or a single chart. */
type Charts = ChartApi & { charts?(): readonly ChartApi[]; getActiveChart?(): number };

const EMPTY: BrokerState = {
  connected: false,
  tradingEnabled: false,
  accounts: [],
  orders: [],
  positions: [],
  fills: [],
};

const storage = (kind: 'local' | 'session'): Storage | null => {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Trading on the chart through a broker adapter. Draws the chosen account's working
 * orders, position and fills on every chart of its symbol, and lets the user trade:
 *
 * - the order panel: market and limit orders, Cancel all, Flatten all
 * - drag the position line out to place a TP (limit) or SL (stop) for the position
 * - drag an order line to move it; × on a line cancels it, or flattens the position
 * - right-click for orders at that price; drag Buy LMT or Sell LMT onto the chart
 *
 * Nothing is sent until the user turns on Trading in the panel; the switch starts off
 * in a new tab. While attached, the layer owns the charts' price lines and markers.
 */
export function attachTrading(api: Charts, options: TradingOptions): TradingLayer {
  const { broker, host } = options;
  const key = options.storageKey ?? 'candleframe';
  let confirm = options.confirm ?? true;
  let state = EMPTY;
  let account: string | null = options.account ?? storage('local')?.getItem(`${key}:trading-account`) ?? null;
  let armed = storage('session')?.getItem(`${key}:trading-armed`) === 'on';
  // Fill badges are on unless the user hid them; the choice is remembered.
  let showFills = storage('local')?.getItem(`${key}:trading-fills`) !== 'off';
  let preview: { chart: ChartApi; line: PriceLine } | null = null;
  let disposed = false;

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const shell = document.createElement('div');
  shell.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5';
  const root = shell.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${TRADING_STYLE}</style><div class="layer"></div>`;
  const layer = root.querySelector<HTMLElement>('.layer')!;
  host.append(shell);

  const charts = () => api.charts?.() ?? [api];
  const activeChart = () => charts()[api.getActiveChart?.() ?? 0] ?? api;
  const pointValue = (symbol: string) => broker.pointValue?.(symbol);
  const money = (value: number, symbol: string) =>
    formatPnl(value, broker.currency ?? '$', pointValue(symbol));
  const canTrade = () => state.connected && state.tradingEnabled && armed && !!account;
  const position = (symbol: string) => (account ? positionOf(state, account, symbol) : null);
  const ordersFor = (symbol: string) =>
    state.orders.filter(o => o.account === account && o.symbol === symbol && o.quantity > 0);

  // --- Theme --------------------------------------------------------------------------
  let themeKey = '';
  function applyTheme() {
    const theme = api.getTheme();
    const p = theme.palette;
    const next = JSON.stringify(p);
    if (next === themeKey) return;
    themeKey = next;
    const vars: Record<string, string> = {
      font: theme.typography.uiFamily,
      background: p.background,
      surface: p.surface,
      raised: p.raised,
      border: p.border,
      text: p.text,
      strong: p.textStrong,
      muted: p.textMuted,
      positive: p.positive,
      negative: p.negative,
      warning: themeColor(theme, '@indicator2'),
      'on-color': p.background,
    };
    shell.style.cssText += Object.entries(vars)
      .map(([name, value]) => `--tr-${name}:${value};`)
      .join('');
  }

  // --- Orders out ---------------------------------------------------------------------
  const ask = async (text: TicketText) => !confirm || (await confirmTicket(layer, text));
  const report = (result: OrderResult, what: string) =>
    result.ok
      ? notify(layer, `${what}: accepted${result.orderId ? ` (order ${result.orderId})` : ''}`)
      : notify(layer, `${what}: ${result.error ?? 'refused'}`, true);
  const guard = <T>(run: () => Promise<T>) =>
    run().catch(error => notify(layer, `Order failed: ${(error as Error).message}`, true));

  async function place(request: OrderRequest, what: string, ticket: TicketText) {
    if (!canTrade() || !(await ask(ticket))) return;
    report(await broker.placeOrder(request), what);
  }

  function lastPrice(chart: ChartApi): number | null {
    return chart.inspect().latestCandle?.close ?? null;
  }
  const fmt = (chart: ChartApi, price: number) =>
    price.toFixed(chart.inspect().feed.instrument.pricePrecision);

  async function placeOrder(
    chart: ChartApi,
    side: 'buy' | 'sell',
    type: OrderRequest['type'],
    quantity: number,
    price?: number,
  ) {
    const symbol = chart.inspect().symbol;
    const last = lastPrice(chart);
    const net = position(symbol)?.quantity ?? 0;
    const marketable =
      type === 'limit' &&
      last !== null &&
      price !== undefined &&
      (side === 'buy' ? price >= last : price <= last);
    const name =
      type === 'market'
        ? 'MARKET'
        : type === 'limit'
          ? `LIMIT @ ${fmt(chart, price!)}`
          : `STOP @ ${fmt(chart, price!)}`;
    await place(
      { account: account!, symbol, side, quantity, type, ...(price !== undefined ? { price } : {}) },
      `${side === 'buy' ? 'Buy' : 'Sell'} ${type}`,
      {
        what: `${side.toUpperCase()} ${quantity} ${symbol} ${name}`,
        details: [
          `Account ${account}`,
          positionEffect(net, side, quantity),
          ...(last !== null ? [`Market ${fmt(chart, last)}`] : []),
        ],
        warnings: marketable ? ['This limit is at or through the market, so it fills right away.'] : [],
        confirmLabel: side === 'buy' ? 'Buy' : 'Sell',
      },
    );
  }

  async function placeExit(chart: ChartApi, price: number) {
    const symbol = chart.inspect().symbol;
    const held = position(symbol);
    const last = lastPrice(chart);
    if (!held || last === null) return;
    const exit = exitAt(held, last, price);
    // Reduce-only: the whole position, whatever the per-order cap for new risk.
    const quantity = exit.quantity;
    await place(
      { account: account!, symbol, side: exit.side, quantity, type: exit.type, price, reduceOnly: true },
      exit.kind,
      {
        what: `${exit.kind}: ${exit.side.toUpperCase()} ${quantity} ${symbol} ${exit.type === 'limit' ? 'LIMIT' : 'STOP'} @ ${fmt(chart, price)}`,
        details: [
          `Account ${account}`,
          `P&L at this price: ${money(pnlAt(held, price, pointValue(symbol) ?? 1), symbol)}`,
        ],
        warnings: [],
        confirmLabel: `Place ${exit.kind}`,
      },
    );
  }

  async function moveOrder(chart: ChartApi, order: BrokerOrder, price: number) {
    if (!canTrade()) return;
    const ok = await ask({
      what: `Move ${order.side.toUpperCase()} ${order.quantity} ${order.type.toUpperCase()} to ${fmt(chart, price)}`,
      details: [`From ${fmt(chart, order.price)}`, `Order ${order.id} on ${order.account}`],
      warnings: [],
      confirmLabel: 'Move order',
    });
    if (ok) report(await broker.modifyOrder(order.account, order.id, { price }), 'Move');
  }

  async function cancelOrder(order: BrokerOrder) {
    if (!canTrade()) return;
    const ok = await ask({
      what: `Cancel ${order.side.toUpperCase()} ${order.quantity} ${order.type.toUpperCase()} @ ${order.price}`,
      details: [`Order ${order.id} on ${order.account}`],
      warnings: [],
      confirmLabel: 'Cancel order',
    });
    if (ok) report(await broker.cancelOrder(order.account, order.id), 'Cancel');
  }

  async function cancelAll(symbol: string): Promise<boolean> {
    const working = ordersFor(symbol);
    if (!working.length) return true;
    const ok = await ask({
      what: `Cancel all ${working.length} working ${symbol} order${working.length === 1 ? '' : 's'}`,
      details: [`Account ${account}`],
      warnings: [],
      confirmLabel: 'Cancel all',
    });
    if (!ok) return false;
    const results = await Promise.all(working.map(o => broker.cancelOrder(o.account, o.id)));
    const failed = results.filter(r => !r.ok);
    if (failed.length)
      notify(
        layer,
        `Cancel all: ${failed.length} of ${results.length} failed. ${failed[0]!.error ?? ''}`,
        true,
      );
    else notify(layer, `Cancelled ${results.length} order${results.length === 1 ? '' : 's'}.`);
    return !failed.length;
  }

  async function flatten(symbol: string) {
    const held = position(symbol);
    if (!held) return;
    const quantity = Math.abs(held.quantity);
    const side = held.quantity > 0 ? 'sell' : 'buy';
    await place({ account: account!, symbol, side, quantity, type: 'market', reduceOnly: true }, 'Flatten', {
      what: `Flatten: ${side.toUpperCase()} ${quantity} ${symbol} MARKET`,
      details: [`Account ${account}`],
      warnings: [],
      confirmLabel: 'Flatten',
    });
  }

  /** Cancels working orders first, so none can fill after the position is closed. */
  async function flattenAll(symbol: string) {
    if (await cancelAll(symbol)) await flatten(symbol);
  }

  // --- Panel --------------------------------------------------------------------------
  const panel = createOrderPanel(
    layer,
    {
      selectAccount(next) {
        account = next;
        storage('local')?.setItem(`${key}:trading-account`, next);
        render();
      },
      showFills(on) {
        showFills = on;
        storage('local')?.setItem(`${key}:trading-fills`, on ? 'on' : 'off');
        render();
      },
      arm(on) {
        armed = on;
        storage('session')?.setItem(`${key}:trading-armed`, on ? 'on' : 'off');
        render();
      },
      order: (side, type, quantity, price) =>
        void guard(() => placeOrder(activeChart(), side, type, quantity, price)),
      cancelAll: () => void guard(() => cancelAll(activeChart().inspect().symbol)),
      flattenAll: () => void guard(() => flattenAll(activeChart().inspect().symbol)),
      drag(side, quantity, phase, x, y) {
        const chart = phase === 'cancel' ? null : charts().find(c => c.priceAt(x, y));
        const at = chart?.priceAt(x, y) ?? null;
        if (phase === 'move' && chart && at) {
          const type = entryTypeAt(side, at.price, lastPrice(chart));
          preview = {
            chart,
            line: {
              price: at.price,
              color: side === 'buy' ? '@positive' : '@negative',
              label: `${side.toUpperCase()} ${type === 'limit' ? 'LMT' : 'STP'}`,
              quantity: String(quantity),
              style: 'dashed',
            },
          };
        } else preview = null;
        render();
        if (phase === 'drop' && chart && at)
          void guard(() =>
            placeOrder(chart, side, entryTypeAt(side, at.price, lastPrice(chart)), quantity, at.price),
          );
      },
    },
    storage('local'),
    key,
  );

  // --- Drawing ------------------------------------------------------------------------
  function linesFor(chart: ChartApi): { lines: PriceLine[]; markers: ChartMarker[]; status: string | null } {
    const symbol = chart.inspect().symbol;
    if (!account) return { lines: [], markers: [], status: null };
    const trading = canTrade();
    const canClose = state.connected && state.tradingEnabled;
    const held = position(symbol);
    const pv = pointValue(symbol);
    const lines: PriceLine[] = ordersFor(symbol).map(order => {
      const look = describeOrder(order, held, order.price, pv, broker.currency);
      const movable = trading && (order.type === 'limit' || order.type === 'stop');
      return {
        price: order.price,
        color: look.tone === 'positive' ? '@positive' : '@negative',
        label: look.label,
        quantity: String(order.quantity),
        style: 'dashed',
        id: `order:${order.id}`,
        // × shows whenever the broker takes orders; with Trading off it explains instead.
        closable: canClose,
        ...(movable ? { drag: 'move' as const } : {}),
      };
    });
    let status: string | null = null;
    if (held) {
      const last = lastPrice(chart);
      const pnl = last === null ? null : pnlAt(held, last, pv ?? 1);
      lines.push({
        price: held.averagePrice,
        color: pnl === null ? '@accent' : pnl >= 0 ? '@positive' : '@negative',
        label: pnl === null ? (held.quantity > 0 ? 'LONG' : 'SHORT') : `PnL ${money(pnl, symbol)}`,
        quantity: `${held.quantity > 0 ? '' : '−'}${Math.abs(held.quantity)}`,
        width: 2,
        id: 'position',
        // × shows whenever the broker takes orders; with Trading off it explains instead.
        closable: canClose,
        ...(trading ? { drag: 'copy' as const } : {}),
      });
      status = `${held.quantity > 0 ? 'Long' : 'Short'} ${Math.abs(held.quantity)} @ ${fmt(chart, held.averagePrice)}${pnl === null ? '' : ` · ${money(pnl, symbol)}`}`;
    }
    if (preview?.chart === chart) lines.push(preview.line);
    const markers: ChartMarker[] = (showFills ? state.fills : [])
      .filter(f => f.account === account && f.symbol === symbol)
      .map(f => ({
        timeMs: f.timeMs,
        price: f.price,
        shape: 'circle',
        glyph: f.side === 'buy' ? 'B' : 'S',
        color: f.side === 'buy' ? '@positive' : '@negative',
        size: 8,
        opacity: 1,
      }));
    return { lines, markers, status };
  }

  let queued = false;
  function render() {
    queued = false;
    if (disposed) return;
    applyTheme();
    if (!account || !state.accounts.includes(account)) account = state.accounts[0] ?? null;
    let status: string | null = null;
    for (const chart of charts()) {
      const drawn = linesFor(chart);
      chart.setPriceLines(drawn.lines);
      chart.setMarkers(drawn.markers);
      if (chart === activeChart()) status = drawn.status;
    }
    const active = activeChart();
    const instrument = active.inspect().feed.instrument;
    panel.update({
      accounts: state.accounts,
      account,
      available: state.connected && state.tradingEnabled,
      armed,
      showFills,
      symbol: instrument.symbol,
      last: lastPrice(active),
      tickSize: instrument.tickSize,
      maxQuantity: state.maxQuantity ?? 1_000_000,
      status: !state.connected
        ? 'Broker not connected'
        : !state.tradingEnabled
          ? 'Read only: the broker does not accept orders'
          : (status ?? 'Flat'),
    });
  }
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  };

  // --- Input from the charts ----------------------------------------------------------
  const unsubscribeDrag = api.subscribePriceLineDrag(event => {
    const chart = activeChart();
    const symbol = chart.inspect().symbol;
    if (event.id === 'position') {
      const held = position(symbol);
      const last = lastPrice(chart);
      if (!held || last === null) return undefined;
      if (event.phase === 'end') void guard(() => placeExit(chart, event.price));
      const exit = exitAt(held, last, event.price);
      return `${exit.kind} ${money(pnlAt(held, event.price, pointValue(symbol) ?? 1), symbol)}`;
    }
    const order = state.orders.find(o => `order:${o.id}` === event.id);
    if (!order) return undefined;
    if (event.phase === 'end' && event.price !== event.fromPrice)
      void guard(() => moveOrder(chart, order, event.price));
    return describeOrder(order, position(symbol), event.price, pointValue(symbol), broker.currency).label;
  });
  const unsubscribeAction = api.subscribePriceLineAction(event => {
    if (!canTrade()) {
      notify(layer, 'Turn on Trading in the order panel to cancel orders or flatten.');
      return;
    }
    const symbol = activeChart().inspect().symbol;
    if (event.id === 'position') void guard(() => flatten(symbol));
    else {
      const order = state.orders.find(o => `order:${o.id}` === event.id);
      if (order) void guard(() => cancelOrder(order));
    }
  });
  const onContextMenu = (event: MouseEvent) => {
    if (!canTrade()) return;
    const chart = charts().find(c => c.priceAt(event.clientX, event.clientY));
    const at = chart?.priceAt(event.clientX, event.clientY);
    if (!chart || !at) return;
    event.preventDefault();
    event.stopPropagation();
    const symbol = chart.inspect().symbol;
    const quantity = panel.quantity();
    const item = (side: 'buy' | 'sell') => {
      const type = entryTypeAt(side, at.price, lastPrice(chart));
      return {
        label: `${side === 'buy' ? 'Buy' : 'Sell'} ${quantity} ${type} @ ${fmt(chart, at.price)}`,
        tone: side,
        action: () => void guard(() => placeOrder(chart, side, type, quantity, at.price)),
      };
    };
    const held = position(symbol);
    const bounds = host.getBoundingClientRect();
    showMenu(layer, event.clientX - bounds.left, event.clientY - bounds.top, [
      item('buy'),
      item('sell'),
      null,
      { label: 'Cancel all orders', action: () => void guard(() => cancelAll(symbol)) },
      ...(held
        ? [
            {
              label: `Flatten ${Math.abs(held.quantity)}`,
              tone: 'danger' as const,
              action: () => void guard(() => flattenAll(symbol)),
            },
          ]
        : []),
    ]);
  };
  host.addEventListener('contextmenu', onContextMenu, true);

  // Redraw when a chart changes market, and as prices move for the P&L.
  let marketKey = '';
  const unsubscribeCharts = api.subscribe(() => {
    const next = charts()
      .map(c => {
        const s = c.inspect();
        return `${s.symbol}|${s.latestCandle?.close}`;
      })
      .join(',');
    if (next === marketKey) return;
    marketKey = next;
    if (broker.onMarketPrice)
      for (const chart of charts()) {
        const s = chart.inspect();
        if (s.latestCandle) broker.onMarketPrice(s.symbol, s.latestCandle.close, s.latestCandle.timeMs);
      }
    schedule();
  });
  // Resizes already asked for, so a resize is sent once until the broker reports it.
  const resizing = new Map<string, number>();
  async function syncExits() {
    if (options.syncExits === false || !canTrade() || !account) return;
    for (const { orderId, quantity } of exitResizes(state, account)) {
      if (resizing.get(orderId) === quantity) continue;
      resizing.set(orderId, quantity);
      const result = await broker.modifyOrder(account, orderId, { quantity });
      if (result.ok) notify(layer, `Resized order ${orderId} to ${quantity} to match the position.`);
      else {
        notify(layer, `Could not resize order ${orderId} to ${quantity}: ${result.error ?? 'refused'}`, true);
        // Keep the failure on record so it is not retried on every update.
      }
    }
    // Forget resizes the broker has applied, or whose orders are gone.
    for (const [orderId, quantity] of resizing) {
      const order = state.orders.find(o => o.id === orderId);
      if (!order || order.quantity === quantity) resizing.delete(orderId);
    }
  }
  const unsubscribeBroker = broker.subscribe(next => {
    state = next;
    schedule();
    void guard(syncExits);
  });
  render();

  return {
    setConfirm(next) {
      confirm = next;
    },
    dispose() {
      disposed = true;
      unsubscribeBroker();
      unsubscribeCharts();
      unsubscribeDrag();
      unsubscribeAction();
      host.removeEventListener('contextmenu', onContextMenu, true);
      for (const chart of charts()) {
        chart.setPriceLines([]);
        chart.setMarkers([]);
      }
      shell.remove();
    },
  };
}
