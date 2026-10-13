import { createPositionEditor } from './position-editor.ts';
import { isPosition, positionMetrics } from './position-drawing.ts';
import type { ChartApi } from './chart.ts';
import { activeChart } from './chart-switch.ts';
import type { RuntimeState } from './types.ts';
import type {
  Drawing,
  DrawingInteractionState,
  DrawingStyle,
  DrawingToolDefinition,
} from './drawing-types.ts';

import { createDrawingTextEditor } from './drawing-text-editor.ts';
import { uiIcon as svg } from './ui-icons.ts';
import { defineSelect, type CfSelectElement } from './select.ts';

/** Line widths offered in the drawing toolbar, in pixels. */
const LINE_WIDTHS = [1, 2, 3, 5, 8];

export interface DrawingWorkbenchElements {
  root: HTMLElement;
  rail: HTMLElement;
  panel: HTMLElement;
  report(message: string): void;
}

/** Instance-owned controls. The widget supplies layout, styles and the chart instance. */
export function createDrawingWorkbench(
  chart: ChartApi,
  { root, rail, panel, report }: DrawingWorkbenchElements,
) {
  const owner = root.ownerDocument;
  defineSelect(owner.defaultView?.customElements);
  const tree = root.getRootNode() as ShadowRoot | Document;
  const activeElement = () => tree.activeElement;
  const catalog = chart.drawingTools();
  const groups = [...new Set(catalog.map(t => t.group))];
  const abort = new AbortController();
  const flyout = owner.createElement('section');
  flyout.className = 'drawing-flyout';
  flyout.hidden = true;
  flyout.setAttribute('aria-label', 'Choose drawing tool');
  flyout.innerHTML = `<div class="drawing-tool-list" role="menu"></div>`;
  root.append(flyout);
  const toolList = flyout.querySelector<HTMLElement>('.drawing-tool-list')!;
  let openGroup = groups[0],
    lastDrawings: readonly Drawing[] | undefined,
    lastHistory = '',
    selection: DrawingInteractionState = chart.drawingState();
  const buttons = new Map<string, HTMLButtonElement>();
  function closeTools() {
    flyout.hidden = true;
    buttons.forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function attempt(action: () => void) {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message.replaceAll('_', ' ') : String(error));
    }
  }
  function choose(tool: DrawingToolDefinition) {
    attempt(() => {
      chart.setTool(tool.type);
      closeTools();
      report(`${tool.label}: ${tool.hint}`);
      activeChart(panel)?.focus({ preventScroll: true });
    });
  }
  function positionTools(button: HTMLElement) {
    const bounds = root.getBoundingClientRect(),
      anchor = button.getBoundingClientRect();
    flyout.style.maxHeight = `${Math.max(0, root.clientHeight - 16)}px`;
    // Beside the rail, with the first row level with the button.
    flyout.style.left = `${Math.max(8, Math.min(anchor.right - bounds.left - root.clientLeft + 6, root.clientWidth - flyout.offsetWidth - 8))}px`;
    flyout.style.top = `${Math.max(8, Math.min(anchor.top - bounds.top - root.clientTop - 4, root.clientHeight - flyout.offsetHeight - 8))}px`;
  }
  function listTools() {
    toolList.replaceChildren();
    for (const t of catalog.filter(t => t.group === openGroup)) {
      const b = owner.createElement('button');
      b.className = 'drawing-tool-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(selection.tool === t.type));
      b.innerHTML = `${svg(t.type, 18)}<span></span>`;
      b.querySelector('span')!.textContent = t.label;
      b.title = t.hint;
      b.addEventListener('click', () => choose(t), { signal: abort.signal });
      toolList.append(b);
    }
  }
  const items = () => [...toolList.querySelectorAll<HTMLButtonElement>('.drawing-tool-item')];
  toolList.addEventListener(
    'keydown',
    event => {
      const list = items(),
        index = list.indexOf(activeElement() as HTMLButtonElement);
      const next =
        event.key === 'ArrowDown'
          ? list[(index + 1) % list.length]
          : event.key === 'ArrowUp'
            ? list[(index - 1 + list.length) % list.length]
            : event.key === 'Home'
              ? list[0]
              : event.key === 'End'
                ? list.at(-1)
                : undefined;
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
    },
    { signal: abort.signal },
  );
  const groupHolder = owner.createElement('div');
  groupHolder.className = 'drawing-rail-groups';
  for (const group of groups) {
    const b = owner.createElement('button');
    b.className = 'rail-button drawing-group-button';
    b.innerHTML = svg(group);
    b.dataset.tooltip = `${group} tools`;
    b.setAttribute('aria-label', `${group} tools`);
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'drawing-tool-picker');
    b.addEventListener(
      'click',
      () => {
        const wasOpen = !flyout.hidden && openGroup === group;
        closeTools();
        if (wasOpen) return;
        openGroup = group;
        flyout.setAttribute('aria-label', `${group} tools`);
        flyout.hidden = false;
        b.setAttribute('aria-expanded', 'true');
        listTools();
        positionTools(b);
        (items().find(item => item.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus({
          preventScroll: true,
        });
      },
      { signal: abort.signal },
    );
    buttons.set(group, b);
    groupHolder.append(b);
  }
  flyout.id = 'drawing-tool-picker';
  rail.querySelector('#trend')?.replaceWith(groupHolder);
  root.addEventListener(
    'pointerdown',
    event => {
      if (!flyout.contains(event.target as Node) && !groupHolder.contains(event.target as Node)) closeTools();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && !flyout.hidden) {
        closeTools();
        buttons.get(openGroup)?.focus({ preventScroll: true });
      }
      if (event.key === 'Escape' && !settings.hidden) {
        toggleSettings(false);
        settingsButton.focus({ preventScroll: true });
      }
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'focusout',
    event => {
      if (!root.contains(event.relatedTarget as Node | null)) closeTools();
    },
    { signal: abort.signal },
  );

  const redo = owner.createElement('button');
  redo.className = 'rail-button';
  redo.id = 'redo';
  redo.setAttribute('aria-label', 'Redo last edit');
  redo.dataset.tooltip = 'Redo · Shift ⌘ / Ctrl Z';
  redo.innerHTML = svg('redo');
  rail.querySelector('#undo')!.after(redo);
  redo.addEventListener('click', () => chart.execute({ type: 'history.redo' }), { signal: abort.signal });
  const strip = owner.createElement('div');
  strip.className = 'drawing-strip';
  strip.innerHTML = `<span class="drawing-active-tool">Cursor</span><label title="Stroke color"><span class="sr-only">Drawing color</span><input type="color" aria-label="Drawing color" value="#a9c4ff"></label><cf-select aria-label="Drawing line width" search="off"><option value="1">1 px</option><option value="2" selected>2 px</option><option value="3">3 px</option><option value="5">5 px</option><option value="8">8 px</option></cf-select><cf-select aria-label="Drawing line style" search="off"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></cf-select><span class="drawing-strip-divider"></span><cf-select aria-label="Drawing magnet" search="off"><option value="off">Magnet off</option><option value="weak">Weak magnet</option><option value="strong">Strong magnet</option></cf-select><button aria-label="Stay in drawing mode" aria-pressed="false" data-tooltip="Keep drawing">${svg('keep', 18)}</button><span class="drawing-strip-divider"></span><button class="drawing-settings-button" aria-label="Drawing settings" aria-expanded="false" aria-controls="drawing-settings" data-tooltip="Settings">${svg('settings', 18)}</button><button class="drawing-lock-button" aria-label="Lock drawing" aria-pressed="false" data-tooltip="Lock">${svg('unlock', 18)}</button><button class="drawing-delete-button" aria-label="Delete drawing" data-tooltip="Delete">${svg('trash', 18)}</button>`;
  panel.append(strip);
  const textEditor = createDrawingTextEditor(chart, panel, report);
  const positionEditor = createPositionEditor(chart, panel);
  const editPositionButton = owner.createElement('button');
  editPositionButton.className = 'drawing-edit-text';
  editPositionButton.textContent = 'Settings';
  editPositionButton.setAttribute('aria-label', 'Edit position settings');
  strip.querySelector('.drawing-active-tool')!.after(editPositionButton);
  function editPosition(drawing: Drawing) {
    closeTools();
    toggleObjects(false);
    toggleSettings(false);
    positionEditor.open(drawing);
  }
  editPositionButton.addEventListener(
    'click',
    () => {
      if (selection.selected) editPosition(selection.selected);
    },
    { signal: abort.signal },
  );
  const editTextButton = owner.createElement('button');
  editTextButton.className = 'drawing-edit-text';
  editTextButton.textContent = 'Edit text';
  editTextButton.setAttribute('aria-label', 'Edit annotation text');
  strip.querySelector('.drawing-active-tool')!.after(editTextButton);
  function editText(drawing: Drawing) {
    closeTools();
    toggleObjects(false);
    toggleSettings(false);
    textEditor.open(drawing);
  }
  editTextButton.addEventListener(
    'click',
    () => {
      if (selection.selected) editText(selection.selected);
    },
    { signal: abort.signal },
  );
  const objectToggle = owner.createElement('button');
  objectToggle.className = 'drawing-objects-button';
  objectToggle.innerHTML = `${svg('layers', 17)}<span>0</span>`;
  objectToggle.setAttribute('aria-label', 'Drawing objects');
  objectToggle.setAttribute('aria-expanded', 'false');
  objectToggle.dataset.tooltip = 'Drawing objects';
  panel.querySelector('.chart-toolbar')!.append(objectToggle);
  const objects = owner.createElement('section');
  objects.className = 'drawing-object-panel';
  objects.hidden = true;
  objects.setAttribute('aria-label', 'Drawing objects and properties');
  objects.innerHTML = `<div class="drawing-panel-heading"><strong>Drawings</strong><span class="drawing-heading-actions"><button id="drawing-hide-all" aria-pressed="false" aria-label="Hide all drawings" title="Hide all">${svg('eye', 16)}</button><button id="drawing-lock-all" aria-pressed="false" aria-label="Lock all drawings" title="Lock all">${svg('unlock', 16)}</button><button class="drawing-close" aria-label="Close drawing objects">${svg('close', 16)}</button></span></div><div class="drawing-object-list"></div>`;
  const settings = owner.createElement('section');
  settings.className = 'drawing-settings';
  settings.id = 'drawing-settings';
  settings.hidden = true;
  settings.setAttribute('aria-label', 'Drawing settings');
  settings.innerHTML = `<div class="drawing-panel-heading"><strong class="drawing-property-title">Defaults</strong><button class="drawing-close" aria-label="Close drawing settings">${svg('close', 16)}</button></div><div class="drawing-properties"><label>Text<textarea aria-label="Drawing text" maxlength="2000" rows="2"></textarea></label><div class="drawing-property-row"><label>Fill opacity<input aria-label="Drawing fill opacity" type="number" min="0" max="1" step="0.05"></label><label>Font size<input aria-label="Drawing font size" type="number" min="10" max="32" step="1"></label></div><label class="drawing-levels-field">Levels<input aria-label="Fibonacci levels" placeholder="0, 0.236, 0.382, 0.5, 0.618, 1"></label><div class="drawing-anchor-fields"></div><div class="drawing-selected-actions"><button data-action="duplicate">Duplicate</button><button data-action="front">Bring to front</button><button data-action="back">Send to back</button></div></div>`;
  panel.append(settings);
  panel.append(objects);
  function positionObjects() {
    // In a grid, open beside the active chart, whose summary holds the toggle.
    const bounds = panel.getBoundingClientRect(),
      anchor = (
        objectToggle.closest('.chart-toolbar') ?? panel.querySelector('.chart-toolbar')!
      ).getBoundingClientRect();
    const top = Math.max(8, anchor.bottom - bounds.top - panel.clientTop + 8);
    objects.style.top = `${top}px`;
    objects.style.right = `${Math.max(10, bounds.right - anchor.right)}px`;
    objects.style.maxHeight = `${Math.max(0, panel.clientHeight - top - 8)}px`;
  }
  function toggleObjects(open: boolean) {
    objects.hidden = !open;
    objectToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      toggleSettings(false);
      positionObjects();
    }
  }
  const settingsButton = strip.querySelector<HTMLButtonElement>('.drawing-settings-button')!;
  function positionSettings() {
    const bounds = panel.getBoundingClientRect(),
      anchor = strip.getBoundingClientRect();
    const bottom = bounds.bottom - anchor.top + 6;
    settings.style.bottom = `${bottom}px`;
    settings.style.maxHeight = `${Math.max(0, panel.clientHeight - bottom - 8)}px`;
  }
  function toggleSettings(open: boolean) {
    settings.hidden = !open;
    settingsButton.setAttribute('aria-expanded', String(open));
    if (open) {
      toggleObjects(false);
      renderProperties();
      positionSettings();
    }
  }
  objectToggle.addEventListener('click', () => toggleObjects(objects.hidden), { signal: abort.signal });
  settingsButton.addEventListener('click', () => toggleSettings(settings.hidden), { signal: abort.signal });
  objects
    .querySelector('.drawing-close')!
    .addEventListener('click', () => toggleObjects(false), { signal: abort.signal });
  settings
    .querySelector('.drawing-close')!
    .addEventListener('click', () => toggleSettings(false), { signal: abort.signal });
  strip.querySelector('.drawing-lock-button')!.addEventListener(
    'click',
    () =>
      attempt(() => {
        const d = selection.selected;
        if (d) chart.execute({ type: 'drawing.update', id: d.id, patch: { locked: !d.locked } });
      }),
    { signal: abort.signal },
  );
  strip.querySelector('.drawing-delete-button')!.addEventListener(
    'click',
    () =>
      attempt(() => {
        if (selection.selected) chart.execute({ type: 'drawing.remove', id: selection.selected.id });
      }),
    { signal: abort.signal },
  );
  function editStyle(patch: Partial<DrawingStyle>) {
    attempt(() =>
      selection.selected
        ? chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { style: patch } })
        : chart.setDrawingOptions({ style: patch }),
    );
  }
  strip
    .querySelector('input')!
    .addEventListener('change', event => editStyle({ color: (event.target as HTMLInputElement).value }), {
      signal: abort.signal,
    });
  strip
    .querySelector<CfSelectElement>('[aria-label="Drawing line width"]')!
    .addEventListener(
      'change',
      event => editStyle({ width: Number((event.target as CfSelectElement).value) }),
      { signal: abort.signal },
    );
  strip
    .querySelector<CfSelectElement>('[aria-label="Drawing line style"]')!
    .addEventListener(
      'change',
      event => editStyle({ lineStyle: (event.target as CfSelectElement).value as DrawingStyle['lineStyle'] }),
      { signal: abort.signal },
    );
  strip.querySelector<CfSelectElement>('[aria-label="Drawing magnet"]')!.addEventListener(
    'change',
    event =>
      chart.setDrawingOptions({
        magnet: (event.target as CfSelectElement).value as 'off' | 'weak' | 'strong',
      }),
    { signal: abort.signal },
  );
  strip
    .querySelector('[aria-label="Stay in drawing mode"]')!
    .addEventListener(
      'click',
      () => chart.setDrawingOptions({ stayInDrawingMode: !selection.options.stayInDrawingMode }),
      { signal: abort.signal },
    );
  objects
    .querySelector('#drawing-hide-all')!
    .addEventListener('click', () => chart.setDrawingOptions({ hidden: !selection.options.hidden }), {
      signal: abort.signal,
    });
  objects.querySelector('#drawing-lock-all')!.addEventListener(
    'click',
    () => {
      const all = chart.exportDocument().drawings;
      chart.execute({ type: 'drawing.lockAll', locked: !all.length || !all.every(d => d.locked) });
    },
    { signal: abort.signal },
  );
  settings.querySelector<HTMLTextAreaElement>('textarea')!.addEventListener(
    'change',
    event =>
      attempt(() => {
        const text = (event.target as HTMLTextAreaElement).value;
        if (selection.selected)
          chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { text } });
        else chart.setDrawingOptions({ text });
      }),
    { signal: abort.signal },
  );
  settings
    .querySelector<HTMLInputElement>('[aria-label="Drawing fill opacity"]')!
    .addEventListener(
      'change',
      event => editStyle({ fillOpacity: Number((event.target as HTMLInputElement).value) }),
      { signal: abort.signal },
    );
  settings
    .querySelector<HTMLInputElement>('[aria-label="Drawing font size"]')!
    .addEventListener(
      'change',
      event => editStyle({ fontSize: Number((event.target as HTMLInputElement).value) }),
      { signal: abort.signal },
    );
  settings.querySelector<HTMLInputElement>('[aria-label="Fibonacci levels"]')!.addEventListener(
    'change',
    event =>
      attempt(() => {
        if (selection.selected)
          chart.execute({
            type: 'drawing.update',
            id: selection.selected.id,
            patch: {
              levels: (event.target as HTMLInputElement).value.trim()
                ? (event.target as HTMLInputElement).value.split(',').map(x => Number(x.trim()))
                : [],
            },
          });
      }),
    { signal: abort.signal },
  );
  settings.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button =>
    button.addEventListener(
      'click',
      () =>
        attempt(() => {
          const d = selection.selected;
          if (!d) return;
          switch (button.dataset.action) {
            case 'duplicate': {
              const id = crypto.randomUUID();
              chart.execute({
                type: 'drawing.duplicate',
                id: d.id,
                newId: id,
                offset: { timeMs: chart.inspect().feed.intervalMs * 3, price: 0 },
              });
              chart.selectDrawing(id);
              break;
            }
            case 'front':
            case 'back':
              chart.execute({ type: 'drawing.order', id: d.id, where: button.dataset.action });
              break;
          }
        }),
      { signal: abort.signal },
    ),
  );
  function renderProperties() {
    const d = selection.selected,
      style = d?.style ?? selection.options.style;
    const tool = catalog.find(t => t.type === (d?.type ?? selection.tool));
    settings.querySelector('.drawing-property-title')!.textContent = d
      ? (tool?.label ?? d.type)
      : `${tool?.label ?? 'Drawing'} defaults`;
    settings.querySelector<HTMLElement>('.drawing-selected-actions')!.hidden = !d;
    const text = settings.querySelector<HTMLTextAreaElement>('textarea')!;
    if (activeElement() !== text) text.value = d?.text ?? selection.options.text;
    settings.querySelector<HTMLInputElement>('[aria-label="Drawing fill opacity"]')!.value = String(
      style.fillOpacity,
    );
    settings.querySelector<HTMLInputElement>('[aria-label="Drawing font size"]')!.value = String(
      style.fontSize,
    );
    settings.querySelector<HTMLElement>('.drawing-levels-field')!.hidden = !d?.type.startsWith('fib-');
    settings.querySelector<HTMLInputElement>('[aria-label="Fibonacci levels"]')!.value =
      d?.levels.join(', ') ?? '';
    const anchors = settings.querySelector('.drawing-anchor-fields')!;
    anchors.replaceChildren();
    const position = isPosition(d);
    settings.querySelector('textarea')!.closest('label')!.hidden = position;
    if (d && position) {
      const metrics = positionMetrics(d),
        summary = owner.createElement('p');
      summary.className = 'drawing-position-summary';
      summary.textContent = `Reward / risk ${metrics.ratio.toFixed(2)}R`;
      const settings = owner.createElement('button');
      settings.className = 'button';
      settings.textContent = 'Edit entry, target and stop';
      settings.disabled = d.locked;
      settings.addEventListener('click', () => editPosition(d), { signal: abort.signal });
      anchors.append(summary, settings);
    } else if (d) {
      if (d.points.length > 8) {
        const note = owner.createElement('p');
        note.textContent = `${d.points.length} path points. Drag the path or its end handles on the chart.`;
        anchors.append(note);
      } else
        d.points.forEach((anchor, index) => {
          const row = owner.createElement('div');
          row.className = 'drawing-anchor-row';
          const name = d.type.endsWith('-position')
            ? ['Entry', 'Target', 'Stop'][index]
            : `Point ${index + 1}`;
          const title = owner.createElement('span');
          title.textContent = name;
          const datetime = owner.createElement('input');
          datetime.type = 'datetime-local';
          datetime.step = '1';
          datetime.setAttribute('aria-label', `${name} time UTC`);
          datetime.title = 'UTC';
          datetime.value = new Date(anchor.timeMs).toISOString().slice(0, 19);
          datetime.disabled = d.locked;
          const price = owner.createElement('input');
          price.type = 'number';
          price.step = 'any';
          price.value = String(anchor.price);
          price.setAttribute('aria-label', `${name} price`);
          price.disabled = d.locked;
          function editAnchor() {
            attempt(() => {
              const points = structuredClone(d!.points);
              points[index] = { timeMs: Date.parse(`${datetime.value}Z`), price: Number(price.value) };
              chart.execute({ type: 'drawing.update', id: d!.id, patch: { points } });
            });
          }
          datetime.addEventListener('change', editAnchor, { signal: abort.signal });
          price.addEventListener('change', editAnchor, { signal: abort.signal });
          row.append(title, datetime, price);
          anchors.append(row);
        });
    }
  }
  function renderObjects() {
    const list = objects.querySelector('.drawing-object-list')!;
    list.replaceChildren();
    const drawings = lastDrawings ?? [];
    objectToggle.querySelector('span')!.textContent = String(drawings.length);
    const hideAll = objects.querySelector<HTMLButtonElement>('#drawing-hide-all')!,
      lockAll = objects.querySelector<HTMLButtonElement>('#drawing-lock-all')!;
    const hidden = selection.options.hidden,
      locked = !!drawings.length && drawings.every(d => d.locked);
    hideAll.innerHTML = svg(hidden ? 'eye-off' : 'eye', 16);
    hideAll.title = hidden ? 'Show all' : 'Hide all';
    hideAll.setAttribute('aria-label', hidden ? 'Show all drawings' : 'Hide all drawings');
    hideAll.setAttribute('aria-pressed', String(hidden));
    lockAll.innerHTML = svg(locked ? 'lock' : 'unlock', 16);
    lockAll.title = locked ? 'Unlock all' : 'Lock all';
    lockAll.setAttribute('aria-label', locked ? 'Unlock all drawings' : 'Lock all drawings');
    lockAll.setAttribute('aria-pressed', String(locked));
    hideAll.disabled = lockAll.disabled = !drawings.length;
    if (!drawings.length) {
      const p = owner.createElement('p');
      p.className = 'drawing-empty';
      p.textContent = 'No drawings';
      list.append(p);
    }
    for (const [index, d] of [...drawings].reverse().entries()) {
      const row = owner.createElement('div');
      row.className = `drawing-object-row${d.id === selection.selected?.id ? ' selected' : ''}`;
      const label = catalog.find(t => t.type === d.type)?.label ?? `Unsupported: ${d.type}`,
        number = drawings.length - index;
      const pick = owner.createElement('button');
      pick.className = 'drawing-object-name';
      pick.innerHTML = svg(d.type, 16);
      pick.append(`${label} ${number}`);
      pick.style.setProperty('--drawing-color', d.style.color);
      pick.setAttribute('aria-label', `Select ${label.toLowerCase()} ${number}`);
      pick.addEventListener('click', () => chart.selectDrawing(d.id), { signal: abort.signal });
      const hide = owner.createElement('button');
      hide.className = `drawing-row-action${d.visible ? '' : ' on'}`;
      hide.innerHTML = svg(d.visible ? 'eye' : 'eye-off', 16);
      hide.title = d.visible ? 'Hide' : 'Show';
      hide.setAttribute('aria-label', `${d.visible ? 'Hide' : 'Show'} ${label.toLowerCase()} ${number}`);
      hide.addEventListener(
        'click',
        () => chart.execute({ type: 'drawing.update', id: d.id, patch: { visible: !d.visible } }),
        { signal: abort.signal },
      );
      const lock = owner.createElement('button');
      lock.className = `drawing-row-action${d.locked ? ' on' : ''}`;
      lock.innerHTML = svg(d.locked ? 'lock' : 'unlock', 16);
      lock.title = d.locked ? 'Unlock' : 'Lock';
      lock.setAttribute('aria-label', `${d.locked ? 'Unlock' : 'Lock'} ${label.toLowerCase()} ${number}`);
      lock.addEventListener(
        'click',
        () => chart.execute({ type: 'drawing.update', id: d.id, patch: { locked: !d.locked } }),
        { signal: abort.signal },
      );
      const remove = owner.createElement('button');
      remove.className = 'drawing-row-action';
      remove.innerHTML = svg('trash', 16);
      remove.title = 'Delete';
      remove.setAttribute('aria-label', `Delete ${label.toLowerCase()} ${number}`);
      remove.addEventListener(
        'click',
        () => attempt(() => chart.execute({ type: 'drawing.remove', id: d.id })),
        {
          signal: abort.signal,
        },
      );
      row.append(pick, hide, lock, remove);
      list.append(row);
    }
  }
  function interaction(value: DrawingInteractionState) {
    selection = value;
    textEditor.selection(value.options.hidden ? null : (value.selected?.id ?? null));
    positionEditor.selection(value.options.hidden ? null : (value.selected?.id ?? null));
    editPositionButton.hidden = !isPosition(value.selected);
    editPositionButton.disabled = !!value.selected?.locked;
    editTextButton.hidden =
      !value.selected || !catalog.find(t => t.type === value.selected!.type)?.editableText;
    editTextButton.disabled = !!value.selected?.locked;
    strip.hidden = value.tool === 'cursor' && !value.selected;
    const definition = catalog.find(t => t.type === value.tool);
    strip.querySelector('.drawing-active-tool')!.textContent = value.selected
      ? (catalog.find(t => t.type === value.selected!.type)?.label ?? value.selected.type)
      : (definition?.label ?? 'Cursor');
    strip
      .querySelector('.drawing-active-tool')!
      .setAttribute('title', definition?.hint ?? 'Select or move a drawing');
    buttons.forEach((button, group) => button.classList.toggle('active', definition?.group === group));
    const cursor = rail.querySelector('#cursor')!;
    cursor.classList.toggle('active', value.tool === 'cursor');
    cursor.setAttribute('aria-pressed', String(value.tool === 'cursor'));
    const textOnly = ['text', 'price-label'].includes(value.selected?.type ?? value.tool);
    strip.querySelector<CfSelectElement>('[aria-label="Drawing line width"]')!.hidden = textOnly;
    strip.querySelector<CfSelectElement>('[aria-label="Drawing line style"]')!.hidden = textOnly;
    const style = value.selected?.style ?? value.options.style;
    const hex = style.color.slice(1);
    strip.querySelector<HTMLInputElement>('input')!.value =
      hex.length <= 4 ? `#${[...hex.slice(0, 3)].map(c => c + c).join('')}` : `#${hex.slice(0, 6)}`;
    const widthSelect = strip.querySelector<CfSelectElement>('[aria-label="Drawing line width"]')!;
    // A width outside the presets gets its own entry.
    if (!widthSelect.items.some(item => Number(item.value) === style.width))
      widthSelect.setItems([
        ...LINE_WIDTHS.map(width => ({ value: String(width), label: `${width} px` })),
        { value: String(style.width), label: `${style.width} px` },
      ]);
    widthSelect.value = String(style.width);
    strip.querySelector<CfSelectElement>('[aria-label="Drawing line style"]')!.value = style.lineStyle;
    strip.querySelector<CfSelectElement>('[aria-label="Drawing magnet"]')!.value = value.options.magnet;
    strip
      .querySelector('[aria-label="Stay in drawing mode"]')!
      .setAttribute('aria-pressed', String(value.options.stayInDrawingMode));
    const lockButton = strip.querySelector<HTMLButtonElement>('.drawing-lock-button')!;
    lockButton.hidden = strip.querySelector<HTMLElement>('.drawing-delete-button')!.hidden = !value.selected;
    lockButton.innerHTML = svg(value.selected?.locked ? 'lock' : 'unlock', 18);
    lockButton.setAttribute('aria-pressed', String(!!value.selected?.locked));
    lockButton.setAttribute('aria-label', value.selected?.locked ? 'Unlock drawing' : 'Lock drawing');
    lockButton.dataset.tooltip = value.selected?.locked ? 'Unlock' : 'Lock';
    if (strip.hidden) toggleSettings(false);
    renderObjects();
    if (!settings.hidden) {
      renderProperties();
      positionSettings();
    }
  }
  function update(state: RuntimeState) {
    const history = JSON.stringify(state.history);
    if (history !== lastHistory) {
      lastHistory = history;
      rail.querySelector<HTMLButtonElement>('#undo')!.disabled = !state.history.canUndo;
      redo.disabled = !state.history.canRedo;
    }
    if (state.document.drawings !== lastDrawings) {
      lastDrawings = state.document.drawings;
      renderObjects();
    }
  }
  const resize = new ResizeObserver(() => {
    const button = buttons.get(openGroup);
    if (!flyout.hidden && button) positionTools(button);
    if (!objects.hidden) positionObjects();
    if (!settings.hidden) positionSettings();
  });
  resize.observe(root);
  resize.observe(panel);
  resize.observe(strip);
  const unsubscribe = chart.subscribe(update);
  interaction(selection);
  return {
    interaction,
    editText,
    editDrawing(drawing: Drawing) {
      if (isPosition(drawing)) editPosition(drawing);
      else editText(drawing);
    },
    dispose() {
      positionEditor.dispose();
      textEditor.dispose();
      unsubscribe();
      abort.abort();
      resize.disconnect();
      flyout.remove();
      strip.remove();
      objectToggle.remove();
      objects.remove();
      settings.remove();
      groupHolder.remove();
      redo.remove();
    },
  };
}
