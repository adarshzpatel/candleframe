/**
 * DOM pieces of the trading layer: the order panel, the confirm ticket, the right-click
 * menu and notices. They render into the layer's own shadow root and take their colors
 * from CSS variables the layer sets from the chart theme.
 */

import { defineSelect, type CfSelectElement } from './select.ts';

export const TRADING_STYLE = `
:host { all: initial; }
.layer { position: absolute; inset: 0; pointer-events: none; font: 12px/1.3 var(--tr-font); color: var(--tr-text); font-variant-numeric: tabular-nums; }
.layer > * { pointer-events: auto; }
.panel {
  position: absolute; z-index: 9; width: 228px; user-select: none;
  background: var(--tr-surface); border: 1px solid var(--tr-border); border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
}
.panel[hidden] { display: none; }
.panel header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: grab; border-bottom: 1px solid var(--tr-border); color: var(--tr-muted); }
.panel header strong { color: var(--tr-strong); }
.panel header .collapse { margin-left: auto; background: none; border: 0; color: inherit; cursor: pointer; font: inherit; padding: 0 2px; }
.panel .body { display: grid; gap: 7px; padding: 8px; }
.panel .body[hidden] { display: none; }
.panel .row { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 6px; }
.panel .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.panel .status { color: var(--tr-muted); min-height: 15px; }
.panel cf-select { display: block; max-width: none; }
.panel cf-select::part(trigger) { padding: 4px 6px; background: var(--tr-background); border-color: var(--tr-border); color: var(--tr-strong); }
.panel input {
  width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 4px; font: inherit;
  border: 1px solid var(--tr-border); background: var(--tr-background); color: var(--tr-strong);
}
.panel .switch { display: flex; align-items: center; gap: 6px; }
.panel .switch:has(.arm:checked) { color: var(--tr-warning); font-weight: 600; }
.panel .switch input { width: auto; }
.panel .price { display: grid; grid-template-columns: 1fr auto; gap: 4px; }
.panel button { font: inherit; cursor: pointer; border-radius: 4px; }
.panel button.small { padding: 0 8px; border: 1px solid var(--tr-border); background: var(--tr-raised); color: inherit; }
.panel button.buy, .panel button.sell { padding: 7px 0; border: 0; font-weight: 600; color: var(--tr-on-color); }
.panel button.buy { background: var(--tr-positive); }
.panel button.sell { background: var(--tr-negative); }
.panel button.outline { padding: 6px 0; font-weight: 600; background: transparent; color: var(--tr-strong); border: 1px solid var(--tr-border); }
.panel button.outline.danger { border-color: var(--tr-negative); color: var(--tr-negative); }
.panel button:disabled, .panel .orders[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
.ticket, .notice, .menu {
  position: absolute; z-index: 20; background: var(--tr-surface); color: var(--tr-strong);
  border: 1px solid var(--tr-border); border-radius: 6px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
}
.ticket { top: 48px; left: 50%; transform: translateX(-50%); padding: 12px 14px; min-width: 300px; }
.ticket p { margin: 0 0 4px; }
.ticket .what { font-size: 14px; font-weight: 600; }
.ticket .warn { color: var(--tr-warning); }
.ticket .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.ticket button { font: inherit; padding: 5px 12px; border-radius: 4px; border: 1px solid var(--tr-border); background: var(--tr-raised); color: inherit; cursor: pointer; }
.ticket button.go { background: var(--tr-strong); color: var(--tr-background); border-color: var(--tr-strong); font-weight: 600; }
.notices { position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 20; }
.notices .notice { position: static; padding: 7px 12px; }
.notice.error { border-color: var(--tr-negative); }
.menu { min-width: 190px; padding: 4px; }
.menu button { display: block; width: 100%; text-align: left; padding: 6px 10px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; cursor: pointer; }
.menu button:hover, .menu button:focus-visible { background: var(--tr-raised); outline: none; }
.menu button.buy { color: var(--tr-positive); }
.menu button.sell { color: var(--tr-negative); }
.menu button.danger { color: var(--tr-warning); }
.menu hr { border: 0; border-top: 1px solid var(--tr-border); margin: 4px 2px; }
`;

export interface TicketText {
  what: string;
  details: readonly string[];
  warnings: readonly string[];
  confirmLabel: string;
}

/** Shows a confirm ticket; resolves true on confirm. Enter confirms, Escape cancels. */
export function confirmTicket(layer: HTMLElement, text: TicketText): Promise<boolean> {
  layer.querySelector('.ticket')?.dispatchEvent(new Event('dismiss'));
  return new Promise(resolve => {
    const ticket = document.createElement('div');
    ticket.className = 'ticket';
    ticket.setAttribute('role', 'dialog');
    ticket.setAttribute('aria-label', 'Confirm order');
    const line = (textContent: string, className = '') =>
      ticket.append(Object.assign(document.createElement('p'), { textContent, className }));
    line(text.what, 'what');
    text.details.forEach(d => line(d));
    text.warnings.forEach(w => line(w, 'warn'));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    const go = Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: text.confirmLabel,
      className: 'go',
    });
    actions.append(cancel, go);
    ticket.append(actions);
    layer.append(ticket);
    go.focus();
    const done = (confirmed: boolean) => {
      ticket.remove();
      window.removeEventListener('keydown', keys, true);
      resolve(confirmed);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      done(event.key === 'Enter');
    };
    ticket.addEventListener('dismiss', () => done(false));
    cancel.onclick = () => done(false);
    go.onclick = () => done(true);
    window.addEventListener('keydown', keys, true);
  });
}

/** A short notice at the bottom of the chart. Up to three stack, newest at the bottom. */
export function notify(layer: HTMLElement, text: string, error = false): void {
  let stack = layer.querySelector<HTMLElement>('.notices');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'notices';
    layer.append(stack);
  }
  const notice = document.createElement('div');
  notice.className = `notice${error ? ' error' : ''}`;
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.textContent = text;
  stack.append(notice);
  while (stack.children.length > 3) stack.firstElementChild!.remove();
  setTimeout(() => notice.remove(), error ? 8000 : 4000);
}

export interface MenuItem {
  label: string;
  tone?: 'buy' | 'sell' | 'danger';
  action(): void;
}

/** A right-click menu at a point in the layer. `null` entries are separators. */
export function showMenu(
  layer: HTMLElement,
  x: number,
  y: number,
  items: readonly (MenuItem | null)[],
): void {
  layer.querySelector('.menu')?.dispatchEvent(new Event('dismiss'));
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    if (!item) {
      menu.append(document.createElement('hr'));
      continue;
    }
    const button = Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: item.label,
      className: item.tone ?? '',
    });
    button.setAttribute('role', 'menuitem');
    button.onclick = () => {
      done();
      item.action();
    };
    buttons.push(button);
    menu.append(button);
  }
  layer.append(menu);
  const bounds = layer.getBoundingClientRect();
  menu.style.left = `${Math.min(x, bounds.width - menu.offsetWidth - 4)}px`;
  menu.style.top = `${Math.min(y, bounds.height - menu.offsetHeight - 4)}px`;
  buttons[0]?.focus();
  const outside = (event: Event) => {
    if (!event.composedPath().includes(menu)) done();
  };
  const keys = (event: KeyboardEvent) => {
    const focused = (menu.getRootNode() as Document | ShadowRoot).activeElement as HTMLButtonElement | null;
    const index = focused ? buttons.indexOf(focused) : -1;
    if (event.key === 'Escape') done();
    else if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus();
    else if (event.key === 'ArrowUp') buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    else return;
    event.preventDefault();
  };
  function done() {
    menu.remove();
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('wheel', done, true);
  }
  menu.addEventListener('dismiss', done);
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', keys, true);
  window.addEventListener('wheel', done, true);
}

export interface PanelState {
  accounts: readonly string[];
  account: string | null;
  /** The relay or broker allows trading, and the switch can be turned on. */
  available: boolean;
  armed: boolean;
  /** Past executions drawn as B and S badges. */
  showFills: boolean;
  symbol: string | null;
  last: number | null;
  tickSize: number;
  maxQuantity: number;
  /** One line under the header: position and P&L, or why trading is off. */
  status: string;
}

export interface PanelActions {
  selectAccount(account: string): void;
  arm(on: boolean): void;
  showFills(on: boolean): void;
  order(side: 'buy' | 'sell', type: 'market' | 'limit', quantity: number, price?: number): void;
  cancelAll(): void;
  flattenAll(): void;
  /** A limit button dragged out of the panel, in client coordinates. */
  drag(side: 'buy' | 'sell', quantity: number, phase: 'move' | 'drop' | 'cancel', x: number, y: number): void;
}

export interface OrderPanel {
  update(state: PanelState): void;
  quantity(): number;
}

/**
 * The floating order panel: account, the Trading switch, quantity, market and limit
 * buttons, Cancel all and Flatten all. Drag it by its header; `storage` keeps where.
 */
export function createOrderPanel(
  layer: HTMLElement,
  actions: PanelActions,
  storage?: Storage | null,
  key = '',
): OrderPanel {
  defineSelect(layer.ownerDocument.defaultView?.customElements);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Order panel');
  panel.innerHTML = `
    <header><strong>Order</strong><span class="where"></span>
      <button class="collapse" type="button" aria-label="Collapse order panel">–</button></header>
    <div class="body">
      <label class="row"><span>Account</span><cf-select class="account" aria-label="Account"></cf-select></label>
      <div class="pair switches"><label class="switch"><input class="arm" type="checkbox"> Trading</label>
        <label class="switch fills"><input class="show-fills" type="checkbox"> Show fills</label></div>
      <div class="status"></div>
      <div class="orders">
        <label class="row"><span>Qty</span><input class="qty" type="number" min="1" step="1" value="1" inputmode="numeric"></label>
        <div class="pair"><button class="buy market" type="button">Buy MKT</button><button class="sell market" type="button">Sell MKT</button></div>
        <label class="row"><span>Limit</span><span class="price"><input class="limit" type="number" inputmode="decimal" aria-label="Limit price">
          <button class="small last" type="button" title="Use last price">Last</button></span></label>
        <div class="pair"><button class="buy limit-order" type="button">Buy LMT</button><button class="sell limit-order" type="button">Sell LMT</button></div>
        <div class="pair"><button class="outline cancel-all" type="button">Cancel all</button><button class="outline danger flatten-all" type="button">Flatten all</button></div>
      </div>
    </div>`;
  layer.append(panel);
  const $ = <T extends Element>(selector: string) => panel.querySelector<T>(selector)!;
  const account = $<CfSelectElement>('.account');
  const arm = $<HTMLInputElement>('.arm');
  const fills = $<HTMLInputElement>('.show-fills');
  const status = $<HTMLDivElement>('.status');
  const orders = $<HTMLDivElement>('.orders');
  const where = $<HTMLSpanElement>('.where');
  const qty = $<HTMLInputElement>('.qty');
  const limit = $<HTMLInputElement>('.limit');
  const body = $<HTMLDivElement>('.body');
  const collapse = $<HTMLButtonElement>('.collapse');
  let state: PanelState | null = null;
  let limitTouched = false;

  const place = (left: number, top: number) => {
    const bounds = layer.getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(bounds.width - panel.offsetWidth, left))}px`;
    panel.style.top = `${Math.max(0, Math.min(bounds.height - panel.offsetHeight, top))}px`;
  };
  const saved = (() => {
    try {
      return JSON.parse(storage?.getItem(`${key}:order-panel`) ?? 'null') as { x: number; y: number } | null;
    } catch {
      return null;
    }
  })();
  requestAnimationFrame(() =>
    saved
      ? place(saved.x, saved.y)
      : place(56, layer.getBoundingClientRect().height - panel.offsetHeight - 48),
  );
  const header = $<HTMLElement>('header');
  header.addEventListener('pointerdown', event => {
    if ((event.target as HTMLElement).closest('button')) return;
    const dx = event.clientX - panel.offsetLeft,
      dy = event.clientY - panel.offsetTop;
    header.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => place(e.clientX - dx, e.clientY - dy);
    header.addEventListener('pointermove', move);
    header.addEventListener(
      'pointerup',
      () => {
        header.removeEventListener('pointermove', move);
        try {
          storage?.setItem(`${key}:order-panel`, JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
        } catch {}
      },
      { once: true },
    );
  });
  collapse.onclick = () => {
    body.hidden = !body.hidden;
    collapse.textContent = body.hidden ? '+' : '–';
    collapse.setAttribute('aria-label', `${body.hidden ? 'Expand' : 'Collapse'} order panel`);
  };
  account.onchange = () => actions.selectAccount(account.value);
  arm.onchange = () => actions.arm(arm.checked);
  fills.onchange = () => actions.showFills(fills.checked);

  const snap = (price: number) => {
    const tick = state?.tickSize ?? 0.01;
    const decimals = String(tick).split('.')[1]?.length ?? 0;
    return Number((Math.round(price / tick) * tick).toFixed(decimals));
  };
  const useLast = () => {
    if (state?.last != null) limit.value = String(snap(state.last));
    limitTouched = false;
  };
  $<HTMLButtonElement>('.last').onclick = useLast;
  limit.oninput = () => (limitTouched = true);
  limit.onchange = () => limit.value && (limit.value = String(snap(Number(limit.value))));
  const quantity = () =>
    Math.max(1, Math.min(state?.maxQuantity ?? Infinity, Math.floor(Number(qty.value) || 1)));
  qty.onchange = () => (qty.value = String(quantity()));
  const ready = () => !!state?.armed && !!state.symbol;

  $<HTMLButtonElement>('.buy.market').onclick = () => ready() && actions.order('buy', 'market', quantity());
  $<HTMLButtonElement>('.sell.market').onclick = () => ready() && actions.order('sell', 'market', quantity());
  $<HTMLButtonElement>('.cancel-all').onclick = () => ready() && actions.cancelAll();
  $<HTMLButtonElement>('.flatten-all').onclick = () => ready() && actions.flattenAll();
  // Limit buttons: a click uses the typed price; dragging out drops an order on the chart.
  for (const side of ['buy', 'sell'] as const) {
    const button = $<HTMLButtonElement>(`.${side}.limit-order`);
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragging) return;
      dragging = false;
      start = null;
      actions.drag(side, quantity(), 'cancel', 0, 0);
    };
    button.addEventListener('pointerdown', event => {
      if (!ready()) return;
      start = { x: event.clientX, y: event.clientY };
      dragging = false;
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (!start) return;
      if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      if (!dragging) window.addEventListener('keydown', escape);
      dragging = true;
      actions.drag(side, quantity(), 'move', event.clientX, event.clientY);
    });
    button.addEventListener('pointerup', event => {
      if (!start) return;
      const wasDragging = dragging;
      start = null;
      dragging = false;
      window.removeEventListener('keydown', escape);
      if (wasDragging) actions.drag(side, quantity(), 'drop', event.clientX, event.clientY);
      else {
        const price = snap(Number(limit.value));
        if (price > 0) actions.order(side, 'limit', quantity(), price);
        else limit.focus();
      }
    });
  }

  return {
    quantity,
    update(next) {
      state = next;
      account.setItems(
        (next.accounts.length ? next.accounts : ['No accounts']).map(a => ({ value: a, label: a })),
        next.account ?? 'No accounts',
      );
      account.disabled = !next.accounts.length;
      arm.checked = next.armed;
      fills.checked = next.showFills;
      arm.disabled = !next.available;
      status.textContent = next.status;
      where.textContent = next.symbol ?? '';
      orders.setAttribute('aria-disabled', String(!ready()));
      for (const button of orders.querySelectorAll('button')) button.disabled = !ready();
      qty.max = String(next.maxQuantity);
      if (!limitTouched) useLast();
    },
  };
}
