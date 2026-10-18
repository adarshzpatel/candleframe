import type { DrawingToolDefinition } from './drawing-types.ts';
import { uiIcon as svg } from './ui-icons.ts';

export const MAX_FAVOURITE_TOOLS = 40;

/** What the widget stores: favourite tool types in toolbar order, and the toolbar's state. */
export interface DrawingFavouriteData {
  version: 1;
  tools: string[];
  /** Shows the floating toolbar while it has tools. */
  visible: boolean;
  /** Toolbar offset from the chart panel's top-left corner in CSS pixels; `null` centres it. */
  position: { x: number; y: number } | null;
}
/** Application storage for favourites, such as an account service. */
export interface DrawingFavouriteStore {
  load(): unknown | Promise<unknown>;
  save(value: DrawingFavouriteData): void | Promise<void>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const TOOL_TYPE = /^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$/;
const empty = (): DrawingFavouriteData => ({ version: 1, tools: [], visible: true, position: null });

/**
 * Reads stored favourites, dropping malformed entries. Types of tools that are not
 * registered stay, so a plugin's favourite returns with its plugin.
 */
export function parseDrawingFavourites(value: unknown): DrawingFavouriteData {
  const result = empty();
  if (!object(value)) return result;
  if (Array.isArray(value.tools))
    for (const type of value.tools)
      if (typeof type === 'string' && TOOL_TYPE.test(type) && !result.tools.includes(type))
        if (result.tools.push(type) >= MAX_FAVOURITE_TOOLS) break;
  if (typeof value.visible === 'boolean') result.visible = value.visible;
  const p = value.position;
  if (object(p) && [p.x, p.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e5))
    result.position = { x: p.x as number, y: p.y as number };
  return result;
}

/** Favourite tools and the toolbar's place, in memory with optional storage. */
export class DrawingFavourites {
  private data = empty();
  private readonly store: DrawingFavouriteStore | undefined;
  private readonly onError: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private changed = false;

  constructor(store?: DrawingFavouriteStore, onError: (error: unknown) => void = () => {}) {
    this.store = store;
    this.onError = onError;
  }
  /** Reads the store. Edits made before it answers win over the stored copy. */
  async load(): Promise<void> {
    if (!this.store) return;
    try {
      const saved = parseDrawingFavourites(await this.store.load());
      if (!this.changed) {
        this.data = saved;
        this.notify();
      }
    } catch (error) {
      this.onError(error);
    }
  }
  /** Called after every change, including a load. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  tools(): string[] {
    return [...this.data.tools];
  }
  has(type: string): boolean {
    return this.data.tools.includes(type);
  }
  /** Adds the tool at the end or removes it. Returns whether it is now a favourite. */
  toggle(type: string): boolean {
    const on = !this.has(type);
    if (on && (!TOOL_TYPE.test(type) || this.data.tools.length >= MAX_FAVOURITE_TOOLS)) return false;
    this.data.tools = on ? [...this.data.tools, type] : this.data.tools.filter(t => t !== type);
    this.persist();
    return on;
  }
  get visible(): boolean {
    return this.data.visible;
  }
  setVisible(visible: boolean): void {
    this.data.visible = visible;
    this.persist();
  }
  get position(): DrawingFavouriteData['position'] {
    return this.data.position && { ...this.data.position };
  }
  setPosition(position: DrawingFavouriteData['position']): void {
    this.data.position = position && { x: Math.round(position.x), y: Math.round(position.y) };
    this.persist();
  }
  snapshot(): DrawingFavouriteData {
    return structuredClone(this.data);
  }
  private notify() {
    this.listeners.forEach(listener => listener());
  }
  private persist() {
    this.changed = true;
    this.notify();
    if (!this.store) return;
    try {
      Promise.resolve(this.store.save(this.snapshot())).catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
  }
}

export interface FavouritesToolbarOptions {
  /** The chart panel the toolbar floats over. */
  panel: HTMLElement;
  catalog: readonly DrawingToolDefinition[];
  favourites: DrawingFavourites;
  choose(tool: DrawingToolDefinition): void;
}

/** A floating, draggable bar of favourite tools. The grip moves it with a pointer or arrow keys. */
export function createFavouritesToolbar({ panel, catalog, favourites, choose }: FavouritesToolbarOptions) {
  const owner = panel.ownerDocument,
    tree = panel.getRootNode() as ShadowRoot | Document;
  const abort = new AbortController(),
    signal = abort.signal;
  const bar = owner.createElement('div');
  bar.className = 'drawing-favourites';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Favourite drawing tools');
  bar.hidden = true;
  const grip = owner.createElement('button');
  grip.className = 'drawing-favourites-grip';
  grip.innerHTML = svg('grip', 16);
  grip.setAttribute('aria-label', 'Move favourites toolbar');
  grip.setAttribute('aria-describedby', 'drawing-favourites-help');
  grip.dataset.tooltip = 'Drag to move';
  const help = owner.createElement('span');
  help.id = 'drawing-favourites-help';
  help.className = 'sr-only';
  help.textContent = 'Arrow keys move the toolbar. Shift moves it further.';
  const list = owner.createElement('div');
  list.className = 'drawing-favourites-list';
  bar.append(grip, help, list);
  panel.append(bar);
  let active = 'cursor';

  const tools = () =>
    favourites
      .tools()
      .map(type => catalog.find(t => t.type === type))
      .filter(t => t !== undefined);
  const toolButtons = () => [...list.querySelectorAll<HTMLButtonElement>('button')];
  /** Keeps the bar inside the panel; `null` places it centred under the chart toolbar. */
  function place(position = favourites.position) {
    if (bar.hidden) return;
    const maxX = Math.max(0, panel.clientWidth - bar.offsetWidth - 4),
      maxY = Math.max(0, panel.clientHeight - bar.offsetHeight - 4);
    const toolbar = panel.querySelector('.chart-toolbar')?.getBoundingClientRect(),
      top = toolbar ? toolbar.bottom - panel.getBoundingClientRect().top - panel.clientTop + 6 : 8;
    const x = position?.x ?? (panel.clientWidth - bar.offsetWidth) / 2,
      y = position?.y ?? top;
    bar.style.left = `${Math.round(Math.max(4, Math.min(x, maxX)))}px`;
    bar.style.top = `${Math.round(Math.max(4, Math.min(y, maxY)))}px`;
  }
  function render() {
    const shown = tools();
    const focused = list.contains(tree.activeElement)
      ? (tree.activeElement as HTMLElement).dataset.tool
      : null;
    bar.hidden = !favourites.visible || !shown.length;
    list.replaceChildren();
    const current = shown.find(t => t.type === active) ?? shown[0];
    for (const tool of shown) {
      const b = owner.createElement('button');
      b.className = 'drawing-favourite';
      b.dataset.tool = tool.type;
      b.innerHTML = svg(tool.type, 18);
      b.setAttribute('aria-label', tool.label);
      b.setAttribute('aria-pressed', String(tool.type === active));
      b.dataset.tooltip = tool.label;
      // One tab stop; arrow keys move between tools, as in a toolbar.
      b.tabIndex = tool === current ? 0 : -1;
      b.addEventListener('click', () => choose(tool), { signal });
      list.append(b);
    }
    if (focused)
      toolButtons()
        .find(b => b.dataset.tool === focused)
        ?.focus({ preventScroll: true });
    place();
  }
  list.addEventListener(
    'keydown',
    event => {
      const all = toolButtons(),
        index = all.indexOf(tree.activeElement as HTMLButtonElement);
      const next =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? all[(index + 1) % all.length]
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? all[(index - 1 + all.length) % all.length]
            : event.key === 'Home'
              ? all[0]
              : event.key === 'End'
                ? all.at(-1)
                : undefined;
      if (!next) return;
      event.preventDefault();
      all.forEach(b => (b.tabIndex = b === next ? 0 : -1));
      next.focus({ preventScroll: true });
    },
    { signal },
  );
  const offset = () => ({ x: bar.offsetLeft, y: bar.offsetTop });
  grip.addEventListener(
    'keydown',
    event => {
      const step = event.shiftKey ? 40 : 10;
      const delta = (
        { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<
          string,
          [number, number]
        >
      )[event.key];
      if (!delta) return;
      event.preventDefault();
      const at = offset();
      place({ x: at.x + delta[0], y: at.y + delta[1] });
      favourites.setPosition(offset());
    },
    { signal },
  );
  let drag: { id: number; x: number; y: number; from: { x: number; y: number } } | null = null;
  grip.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: offset() };
      bar.classList.add('dragging');
    },
    { signal },
  );
  grip.addEventListener(
    'pointermove',
    event => {
      if (drag?.id !== event.pointerId) return;
      place({ x: drag.from.x + event.clientX - drag.x, y: drag.from.y + event.clientY - drag.y });
    },
    { signal },
  );
  const drop = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    const moved = offset().x !== drag.from.x || offset().y !== drag.from.y;
    drag = null;
    bar.classList.remove('dragging');
    if (moved) favourites.setPosition(offset());
  };
  grip.addEventListener('pointerup', drop, { signal });
  grip.addEventListener('pointercancel', drop, { signal });
  const unsubscribe = favourites.subscribe(render);
  const resize = new ResizeObserver(() => place());
  resize.observe(panel);
  render();
  return {
    /** Highlights the active tool. */
    setActive(type: string) {
      if (type === active) return;
      active = type;
      render();
    },
    dispose() {
      unsubscribe();
      resize.disconnect();
      abort.abort();
      bar.remove();
    },
  };
}

export const drawingFavouriteStyles: string = `
.drawing-favourites{position:absolute;z-index:18;display:flex;align-items:center;gap:calc(2px * var(--space));padding:calc(3px * var(--space));background:var(--surface);border:var(--border-width) solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);touch-action:none}.drawing-favourites[hidden]{display:none}.drawing-favourites.dragging{opacity:.85}.drawing-favourites-list{display:flex;gap:calc(2px * var(--space))}.drawing-favourites button{display:grid;place-items:center;width:calc(var(--control-height) + 2px);height:calc(var(--control-height) + 2px);border-radius:var(--radius);color:var(--muted)}.drawing-favourites button:hover,.drawing-favourites button:focus-visible{background:var(--hover);color:var(--bright)}.drawing-favourites .drawing-favourites-grip{width:calc(var(--control-height) - 8px);color:var(--faint);cursor:grab}.drawing-favourites.dragging .drawing-favourites-grip{cursor:grabbing}.drawing-favourites .drawing-favourite[aria-pressed=true]{background:var(--selected);color:var(--accent)}
.drawing-tool-row{display:flex;align-items:center}.drawing-tool-row .drawing-tool-item{flex:1;min-width:0}.drawing-tool-star{display:grid;place-items:center;flex:none;width:calc(var(--control-height) - 2px);height:calc(var(--control-height) - 2px);margin-right:calc(4px * var(--space));border-radius:var(--radius);color:var(--faint);opacity:0}.drawing-tool-row:hover .drawing-tool-star,.drawing-tool-star:focus-visible,.drawing-tool-star[aria-checked=true]{opacity:1}.drawing-tool-star:hover,.drawing-tool-star:focus-visible{background:var(--hover);color:var(--bright)}.drawing-tool-star[aria-checked=true]{color:var(--accent)}@media (hover:none){.drawing-tool-star{opacity:1}}
`;
