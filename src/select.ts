/**
 * `<cf-select>`: a select with grouped options, hints, search and full styling, as a
 * drop-in for `<select>`. It keeps the native contract (`value`, `disabled`, a bubbling
 * `change` event) and reads `<option>` children, so templates only change the tag name.
 * It follows the ARIA combobox and listbox pattern: arrow keys, Home and End, type-ahead,
 * Enter to choose, Escape and Tab to close. Colors come from inherited CSS variables
 * (the widget's `--surface`, `--line` and so on); `::part(trigger)` styles the button.
 */

export interface SelectItem {
  value: string;
  label: string;
  /** Items with the same group are listed under its heading, in order of appearance. */
  group?: string;
  /** Muted text on the right, such as a description or shortcut. */
  hint?: string;
  disabled?: boolean;
}

export interface CfSelectElement extends HTMLElement {
  value: string;
  disabled: boolean;
  readonly items: readonly SelectItem[];
  /** Replaces the items, and the value when given. */
  setItems(items: readonly SelectItem[], value?: string): void;
  /** Number of items, like `select.options.length`. */
  readonly length: number;
  /**
   * Turns typed text into an option that is not in the list, such as a custom interval,
   * or returns null. When set, the list always has a search box, and a valid entry is
   * offered first as `Use "<label>"`.
   */
  custom: ((text: string) => SelectItem | null) | null;
}

const STYLE = `
:host { display: inline-block; position: relative; min-width: 0; max-width: 170px; font: inherit; color: inherit; vertical-align: middle; }
:host([hidden]) { display: none; }
.trigger {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 100%; min-height: inherit; box-sizing: border-box;
  padding: calc(7px * var(--space, 1)) calc(8px * var(--space, 1)) calc(7px * var(--space, 1)) calc(10px * var(--space, 1));
  border: var(--border-width, 1px) solid var(--line, var(--tr-border, #333));
  border-radius: var(--radius, 4px); background: var(--raised, var(--tr-raised, #1c1c1c));
  color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.trigger:hover:not(:disabled) { background-color: var(--hover, var(--tr-raised, #262626)); color: var(--bright, inherit); }
.trigger:focus-visible { outline: var(--theme-effects-focusWidth, 2px) solid var(--accent, #4c8dff); outline-offset: -2px; }
.trigger:disabled { cursor: default; }
.trigger:disabled .chevron { display: none; }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { flex: none; width: 10px; height: 10px; opacity: 0.7; }
:host([open]) .chevron { opacity: 1; }
.popup {
  position: fixed; z-index: 1000; display: flex; flex-direction: column; box-sizing: border-box; min-width: 140px; max-width: 320px;
  padding: 4px; border: var(--border-width, 1px) solid var(--line, var(--tr-border, #333)); border-radius: calc(var(--radius, 4px) + 2px);
  background: var(--surface, var(--tr-surface, #0e0e0e)); color: var(--text, var(--tr-text, #ddd));
  box-shadow: var(--theme-shadow, 0 8px 24px rgb(0 0 0 / 0.45)); font: inherit; font-weight: normal;
}
.popup[hidden] { display: none; }
/* In the top layer, the popup escapes ancestors' transforms and overflow; fixed coordinates stay viewport ones. */
.popup:popover-open { margin: 0; inset: auto; overflow: visible; }
.search {
  margin: 0 0 4px; padding: 6px 8px; border-radius: var(--radius, 4px); border: var(--border-width, 1px) solid var(--line, #333);
  background: var(--bg, var(--tr-background, #000)); color: var(--bright, var(--tr-strong, #fff)); font: inherit; outline: none;
}
.search:focus { border-color: var(--accent, #4c8dff); }
.list { overflow-y: auto; max-height: 320px; overscroll-behavior: contain; }
.heading { padding: 8px 8px 4px; font-size: 0.85em; color: var(--faint, var(--tr-muted, #888)); text-transform: uppercase; letter-spacing: 0.04em; }
.option {
  display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius, 4px);
  cursor: pointer; white-space: nowrap; user-select: none;
}
.option[aria-disabled='true'] { opacity: 0.4; cursor: default; }
.option.active { background: var(--hover, var(--tr-raised, #262626)); color: var(--bright, var(--tr-strong, #fff)); }
.option[aria-selected='true'] { color: var(--accent, #4c8dff); font-weight: 600; }
.option .text { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.option .hint { color: var(--faint, var(--tr-muted, #888)); font-size: 0.9em; font-weight: normal; }
.check { width: 12px; flex: none; visibility: hidden; }
.option[aria-selected='true'] .check { visibility: visible; }
.empty { padding: 8px; color: var(--faint, var(--tr-muted, #888)); }
`;

const CHEVRON =
  '<svg class="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK =
  '<svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Lists longer than this get a search box, unless `search` is set to on or off. */
const SEARCH_AFTER = 10;
let nextId = 0;

/**
 * Registers `<cf-select>` once per registry. Call before creating the element; the widget
 * and the trading layer do. Kept out of module scope so importing has no side effects.
 */
export function defineSelect(registry: CustomElementRegistry = customElements): void {
  if (registry.get('cf-select')) return;

  class CfSelect extends HTMLElement implements CfSelectElement {
    static observedAttributes = ['aria-label', 'disabled'];
    #items: SelectItem[] = [];
    #value = '';
    #disabled = false;
    #active = -1;
    #query = '';
    #typed = '';
    #typedTimer: ReturnType<typeof setTimeout> | undefined;
    #id = `cf-select-${++nextId}`;
    #trigger!: HTMLButtonElement;
    #labelText!: HTMLSpanElement;
    #popup!: HTMLDivElement;
    #search!: HTMLInputElement;
    #list!: HTMLDivElement;
    #shown: { item: SelectItem; element: HTMLElement }[] = [];
    custom: ((text: string) => SelectItem | null) | null = null;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
      root.innerHTML = `<style>${STYLE}</style>
        <button class="trigger" part="trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false"
          aria-controls="${this.#id}-list"><span class="label" part="label"></span>${CHEVRON}</button>
        <div class="popup" part="popup" popover="manual" hidden>
          <input class="search" type="text" aria-label="Search" placeholder="Search" autocomplete="off" spellcheck="false" hidden>
          <div class="list" role="listbox" id="${this.#id}-list"></div>
        </div>`;
      this.#trigger = root.querySelector('.trigger')!;
      this.#labelText = root.querySelector('.label')!;
      this.#popup = root.querySelector('.popup')!;
      this.#search = root.querySelector('.search')!;
      this.#list = root.querySelector('.list')!;
      this.#trigger.addEventListener('click', () =>
        this.hasAttribute('open') ? this.#close() : this.#open(),
      );
      this.#trigger.addEventListener('keydown', event => this.#onKey(event));
      this.#search.addEventListener('keydown', event => this.#onKey(event));
      this.#search.addEventListener('input', () => {
        this.#query = this.#search.value.trim().toLowerCase();
        this.#render();
        this.#move(this.#firstEnabled(0, 1));
      });
      this.#list.addEventListener('pointerdown', event => event.preventDefault()); // Keep focus.
      this.#list.addEventListener('click', event => {
        const index = this.#shown.findIndex(s => s.element === (event.target as Element).closest('.option'));
        if (index >= 0) this.#choose(index);
      });
      this.#list.addEventListener('pointermove', event => {
        const index = this.#shown.findIndex(s => s.element === (event.target as Element).closest('.option'));
        if (index >= 0 && index !== this.#active) this.#move(index, false);
      });
    }

    connectedCallback() {
      // Read <option> children once, so `<cf-select>` works as a markup drop-in.
      if (!this.#items.length) {
        const options = [...this.querySelectorAll('option')];
        if (options.length) {
          const selected = options.find(o => o.selected) ?? options[0]!;
          this.setItems(
            options.map(o => ({ value: o.value, label: o.textContent ?? o.value, disabled: o.disabled })),
            selected.value,
          );
          for (const o of options) o.remove();
        }
      }
      this.#syncLabel();
    }

    disconnectedCallback() {
      this.#close();
    }

    attributeChangedCallback(name: string, _old: string | null, next: string | null) {
      if (name === 'aria-label') this.#syncLabel();
      if (name === 'disabled') this.disabled = next !== null;
    }

    get items(): readonly SelectItem[] {
      return this.#items;
    }
    get length(): number {
      return this.#items.length;
    }
    get value(): string {
      return this.#value;
    }
    set value(next: string) {
      this.#value = String(next);
      this.#syncLabel();
    }
    get disabled(): boolean {
      return this.#disabled;
    }
    set disabled(next: boolean) {
      if (this.#disabled === !!next) return;
      this.#disabled = !!next;
      this.toggleAttribute('disabled', this.#disabled);
      this.#trigger.disabled = this.#disabled;
      if (this.#disabled) this.#close();
    }

    setItems(items: readonly SelectItem[], value?: string) {
      this.#items = items.map(item => ({ ...item }));
      if (value !== undefined) this.#value = value;
      this.#syncLabel();
      if (this.hasAttribute('open')) this.#render();
    }

    #syncLabel() {
      const current = this.#items.find(item => item.value === this.#value);
      this.#labelText.textContent = current?.label ?? this.#value;
      const name = this.getAttribute('aria-label') ?? '';
      this.#trigger.setAttribute('aria-label', current ? `${name}: ${current.label}` : name);
    }

    #searchable() {
      if (this.custom) return true;
      const mode = this.getAttribute('search');
      return mode === 'on' || (mode !== 'off' && this.#items.length > SEARCH_AFTER);
    }

    #render() {
      this.#list.replaceChildren();
      this.#shown = [];
      let group: string | undefined;
      const matches = this.#items.filter(
        item =>
          !this.#query ||
          `${item.label} ${item.value} ${item.hint ?? ''}`.toLowerCase().includes(this.#query),
      );
      // A typed entry that is valid but not listed, offered first.
      const typed = this.custom && this.#query ? this.custom(this.#search.value.trim()) : null;
      if (typed && !this.#items.some(item => item.value === typed.value))
        matches.unshift({ ...typed, label: `Use "${typed.label}"`, group: undefined });
      for (const [i, item] of matches.entries()) {
        if (item.group !== undefined && item.group !== group) {
          const heading = document.createElement('div');
          heading.className = 'heading';
          heading.setAttribute('role', 'presentation');
          heading.textContent = item.group;
          this.#list.append(heading);
        }
        group = item.group;
        const option = document.createElement('div');
        option.className = 'option';
        option.id = `${this.#id}-${i}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(item.value === this.#value));
        if (item.disabled) option.setAttribute('aria-disabled', 'true');
        option.innerHTML = `${CHECK}<span class="text"></span>${item.hint ? '<span class="hint"></span>' : ''}`;
        option.querySelector('.text')!.textContent = item.label;
        if (item.hint) option.querySelector('.hint')!.textContent = item.hint;
        this.#list.append(option);
        this.#shown.push({ item, element: option });
      }
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = this.custom
          ? 'No matches. Type a value such as the examples above.'
          : 'No matches';
        this.#list.append(empty);
      }
    }

    #open() {
      if (this.#disabled || this.hasAttribute('open') || !this.#items.length) return;
      this.toggleAttribute('open', true);
      this.#trigger.setAttribute('aria-expanded', 'true');
      this.#query = '';
      this.#search.value = '';
      const searchable = this.#searchable();
      this.#search.hidden = !searchable;
      this.#search.placeholder = this.getAttribute('search-placeholder') ?? 'Search';
      this.#render();
      this.#popup.hidden = false;
      if (typeof this.#popup.showPopover === 'function') this.#popup.showPopover();
      this.#place();
      const selected = this.#shown.findIndex(s => s.item.value === this.#value);
      this.#move(selected >= 0 ? selected : this.#firstEnabled(0, 1));
      if (searchable) this.#search.focus();
      window.addEventListener('pointerdown', this.#outside, true);
      window.addEventListener('resize', this.#onResize);
      window.addEventListener('scroll', this.#onScroll, true);
    }

    #close(focusTrigger = false) {
      if (!this.hasAttribute('open')) return;
      this.toggleAttribute('open', false);
      this.#trigger.setAttribute('aria-expanded', 'false');
      this.#trigger.removeAttribute('aria-activedescendant');
      if (this.#popup.matches(':popover-open')) this.#popup.hidePopover();
      this.#popup.hidden = true;
      window.removeEventListener('pointerdown', this.#outside, true);
      window.removeEventListener('resize', this.#onResize);
      window.removeEventListener('scroll', this.#onScroll, true);
      if (focusTrigger) this.#trigger.focus();
    }

    /** Below the trigger, or above when there is more room there; within the viewport. */
    #place() {
      const box = this.#trigger.getBoundingClientRect();
      const popup = this.#popup;
      popup.style.minWidth = `${Math.max(140, box.width)}px`;
      const below = window.innerHeight - box.bottom - 8;
      const above = box.top - 8;
      const height = Math.min(popup.scrollHeight, 360);
      const up = height > below && above > below;
      this.#list.style.maxHeight = `${Math.max(120, (up ? above : below) - (this.#search.hidden ? 12 : 48))}px`;
      popup.style.top = up ? '' : `${box.bottom + 4}px`;
      popup.style.bottom = up ? `${window.innerHeight - box.top + 4}px` : '';
      const width = popup.offsetWidth,
        left = Math.max(4, Math.min(box.left, window.innerWidth - width - 4));
      popup.style.left = `${left}px`;
      // Without the top layer, a transformed ancestor (such as a bar centred with translateX)
      // becomes the containing block for position: fixed. Shift by its offset.
      const placed = popup.getBoundingClientRect(),
        dx = placed.left - left,
        dy = up ? placed.bottom - (box.top - 4) : placed.top - (box.bottom + 4);
      if (Math.abs(dx) > 0.5) popup.style.left = `${left - dx}px`;
      if (Math.abs(dy) > 0.5) {
        if (up) popup.style.bottom = `${window.innerHeight - box.top + 4 + dy}px`;
        else popup.style.top = `${box.bottom + 4 - dy}px`;
      }
    }

    #outside = (event: Event) => {
      if (!event.composedPath().includes(this)) this.#close();
    };
    #onResize = () => this.#place();
    #onScroll = (event: Event) => {
      if (!event.composedPath().includes(this.#list)) this.#close();
    };

    #firstEnabled(from: number, step: 1 | -1): number {
      for (let i = from; i >= 0 && i < this.#shown.length; i += step)
        if (!this.#shown[i]!.item.disabled) return i;
      return -1;
    }

    #move(index: number, scroll = true) {
      this.#shown[this.#active]?.element.classList.remove('active');
      this.#active = index;
      const target = this.#shown[index];
      if (!target) {
        this.#trigger.removeAttribute('aria-activedescendant');
        return;
      }
      target.element.classList.add('active');
      this.#trigger.setAttribute('aria-activedescendant', target.element.id);
      this.#search.setAttribute('aria-activedescendant', target.element.id);
      // Scroll the list only: scrollIntoView would also scroll the widget's panels.
      if (scroll) {
        const list = this.#list,
          top =
            target.element.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop,
          bottom = top + target.element.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      }
    }

    #choose(index: number) {
      const target = this.#shown[index];
      if (!target || target.item.disabled) return;
      const changed = target.item.value !== this.#value;
      this.#value = target.item.value;
      this.#syncLabel();
      this.#close(true);
      if (changed) this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    #onKey(event: KeyboardEvent) {
      const open = this.hasAttribute('open');
      const fromSearch = event.target === this.#search;
      if (!open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          this.#open();
        }
        return;
      }
      const last = this.#shown.length - 1;
      switch (event.key) {
        case 'ArrowDown': {
          const next = this.#firstEnabled(this.#active + 1, 1);
          this.#move(next >= 0 ? next : this.#active);
          break;
        }
        case 'ArrowUp': {
          const next = this.#firstEnabled(this.#active - 1, -1);
          this.#move(next >= 0 ? next : this.#active);
          break;
        }
        case 'Home':
          if (fromSearch) return;
          this.#move(this.#firstEnabled(0, 1));
          break;
        case 'End':
          if (fromSearch) return;
          this.#move(this.#firstEnabled(last, -1));
          break;
        case 'PageDown':
          this.#move(this.#firstEnabled(Math.min(last, this.#active + 8), 1));
          break;
        case 'PageUp':
          this.#move(this.#firstEnabled(Math.max(0, this.#active - 8), -1));
          break;
        case 'Enter':
          this.#choose(this.#active);
          break;
        case ' ':
          if (fromSearch) return;
          this.#choose(this.#active);
          break;
        case 'Escape':
          this.#close(true);
          break;
        case 'Tab':
          this.#close();
          return;
        default:
          // Type-ahead jumps to the next label starting with what was typed.
          if (fromSearch || event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
          clearTimeout(this.#typedTimer);
          this.#typed += event.key.toLowerCase();
          this.#typedTimer = setTimeout(() => (this.#typed = ''), 600);
          {
            const start = this.#typed.length === 1 ? this.#active + 1 : this.#active;
            const order = [...this.#shown.keys()].map(i => (i + Math.max(0, start)) % this.#shown.length);
            const hit = order.find(
              i =>
                !this.#shown[i]!.item.disabled &&
                this.#shown[i]!.item.label.toLowerCase().startsWith(this.#typed),
            );
            if (hit !== undefined) this.#move(hit);
          }
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }

  registry.define('cf-select', CfSelect);
}
