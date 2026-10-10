import { createPositionEditor } from './position-editor.ts';
import { isPosition, positionMetrics } from './position-drawing.ts';
import type { ChartApi } from './chart.ts';
import type { RuntimeState } from './types.ts';
import type {
  Drawing,
  DrawingInteractionState,
  DrawingStyle,
  DrawingToolDefinition,
} from './drawing-types.ts';

import { createDrawingTextEditor } from './drawing-text-editor.ts';
import { uiIcon as svg } from './ui-icons.ts';

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
  const tree = root.getRootNode() as ShadowRoot | Document;
  const activeElement = () => tree.activeElement;
  const catalog = chart.drawingTools();
  const groups = [...new Set(catalog.map(t => t.group))];
  const abort = new AbortController();
  const flyout = owner.createElement('section');
  flyout.className = 'drawing-flyout';
  flyout.hidden = true;
  flyout.setAttribute('aria-label', 'Choose drawing tool');
  flyout.innerHTML = `<div class="drawing-panel-heading"><strong id="drawing-group-title">Drawing tools</strong><button aria-label="Close drawing tools">${svg('close', 18)}</button></div><input type="search" placeholder="Search drawing tools" aria-label="Search drawing tools"><div class="drawing-tool-list"></div>`;
  root.append(flyout);
  const search = flyout.querySelector<HTMLInputElement>('input')!,
    toolList = flyout.querySelector<HTMLElement>('.drawing-tool-list')!;
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
      panel.querySelector<HTMLElement>('.oc-chart')?.focus({ preventScroll: true });
    });
  }
  function positionTools(button: HTMLElement) {
    const bounds = root.getBoundingClientRect(),
      anchor = button.getBoundingClientRect();
    flyout.style.maxHeight = `${Math.max(0, root.clientHeight - 16)}px`;
    flyout.style.left = `${Math.max(8, Math.min(anchor.right - bounds.left - root.clientLeft + 4, root.clientWidth - flyout.offsetWidth - 8))}px`;
    flyout.style.top = `${Math.max(8, Math.min(anchor.top - bounds.top - root.clientTop, root.clientHeight - flyout.offsetHeight - 8))}px`;
  }
  function listTools() {
    const query = search.value.toLowerCase().trim();
    toolList.replaceChildren();
    const tools = catalog.filter(t =>
      query ? `${t.label} ${t.group}`.toLowerCase().includes(query) : t.group === openGroup,
    );
    for (const t of tools) {
      const b = owner.createElement('button');
      b.className = 'drawing-tool-item';
      b.setAttribute('aria-label', `Draw ${t.label.toLowerCase()}`);
      b.setAttribute('aria-pressed', String(selection.tool === t.type));
      b.innerHTML = `${svg(t.type)}<span></span><small></small>`;
      b.querySelector('span')!.textContent = t.label;
      b.querySelector('small')!.textContent = t.create
        ? '1 click'
        : t.points === 'freehand'
          ? 'drag'
          : t.points === 'path'
            ? 'path'
            : `${t.points} pt`;
      b.title = t.hint;
      b.addEventListener('click', () => choose(t), { signal: abort.signal });
      toolList.append(b);
    }
    if (!tools.length) toolList.textContent = 'No matching tools.';
  }
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
        search.value = '';
        flyout.querySelector('strong')!.textContent = group;
        flyout.hidden = false;
        b.setAttribute('aria-expanded', 'true');
        listTools();
        positionTools(b);
        search.focus({ preventScroll: true });
      },
      { signal: abort.signal },
    );
    buttons.set(group, b);
    groupHolder.append(b);
  }
  flyout.id = 'drawing-tool-picker';
  rail.querySelector('#trend')?.replaceWith(groupHolder);
  search.addEventListener(
    'input',
    () => {
      listTools();
      const button = buttons.get(openGroup);
      if (button) positionTools(button);
    },
    { signal: abort.signal },
  );
  flyout.querySelector('button')!.addEventListener('click', closeTools, { signal: abort.signal });
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
  strip.innerHTML = `<span class="drawing-active-tool">Cursor</span><label title="Stroke color"><span class="sr-only">Drawing color</span><input type="color" aria-label="Drawing color" value="#a9c4ff"></label><select aria-label="Drawing line width"><option value="1">1 px</option><option value="2" selected>2 px</option><option value="3">3 px</option><option value="5">5 px</option><option value="8">8 px</option></select><select aria-label="Drawing line style"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select><span class="drawing-strip-divider"></span><select aria-label="Drawing magnet"><option value="off">Magnet off</option><option value="weak">Weak magnet</option><option value="strong">Strong magnet</option></select><button aria-label="Stay in drawing mode" aria-pressed="false" data-tooltip="Keep drawing">${svg('keep', 18)}</button>`;
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
  objects.innerHTML = `<div class="drawing-panel-heading"><strong>Drawings</strong><button aria-label="Close drawing objects">${svg('close', 18)}</button></div><div class="drawing-global-actions"><button id="drawing-hide-all" aria-pressed="false">Hide all</button><button id="drawing-lock-all" aria-pressed="false">Lock all</button></div><div class="drawing-object-list"></div><div class="drawing-properties"><div class="drawing-property-title">New drawing defaults</div><div class="drawing-selected-actions"><button data-action="duplicate">Duplicate</button><button data-action="front">To front</button><button data-action="back">To back</button><button data-action="lock">Lock</button><button data-action="hide">Hide</button><button data-action="delete">Delete</button></div><label>Text<textarea aria-label="Drawing text" maxlength="2000" rows="2"></textarea></label><div class="drawing-property-row"><label>Fill opacity<input aria-label="Drawing fill opacity" type="number" min="0" max="1" step="0.05"></label><label>Font size<input aria-label="Drawing font size" type="number" min="10" max="32" step="1"></label></div><label class="drawing-levels-field">Levels, comma separated<input aria-label="Fibonacci levels" placeholder="0, 0.236, 0.382, 0.5, 0.618, 1"></label><div class="drawing-anchor-fields"></div><p class="drawing-shortcuts">Delete removes selection. ⌘/Ctrl+C, V and D copy, paste and duplicate. Enter finishes a path. Escape cancels.</p></div>`;
  panel.append(objects);
  function positionObjects() {
    const bounds = panel.getBoundingClientRect(),
      anchor = panel.querySelector('.chart-toolbar')!.getBoundingClientRect();
    const top = Math.max(8, anchor.bottom - bounds.top - panel.clientTop + 8);
    objects.style.top = `${top}px`;
    objects.style.maxHeight = `${Math.max(0, panel.clientHeight - top - 8)}px`;
  }
  function toggleObjects(open: boolean) {
    objects.hidden = !open;
    objectToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderProperties();
      positionObjects();
    }
  }
  objectToggle.addEventListener('click', () => toggleObjects(objects.hidden), { signal: abort.signal });
  objects
    .querySelector('.drawing-panel-heading button')!
    .addEventListener('click', () => toggleObjects(false), { signal: abort.signal });
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
    .querySelector<HTMLSelectElement>('[aria-label="Drawing line width"]')!
    .addEventListener(
      'change',
      event => editStyle({ width: Number((event.target as HTMLSelectElement).value) }),
      { signal: abort.signal },
    );
  strip
    .querySelector<HTMLSelectElement>('[aria-label="Drawing line style"]')!
    .addEventListener(
      'change',
      event =>
        editStyle({ lineStyle: (event.target as HTMLSelectElement).value as DrawingStyle['lineStyle'] }),
      { signal: abort.signal },
    );
  strip.querySelector<HTMLSelectElement>('[aria-label="Drawing magnet"]')!.addEventListener(
    'change',
    event =>
      chart.setDrawingOptions({
        magnet: (event.target as HTMLSelectElement).value as 'off' | 'weak' | 'strong',
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
  objects.querySelector<HTMLTextAreaElement>('textarea')!.addEventListener(
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
  objects
    .querySelector<HTMLInputElement>('[aria-label="Drawing fill opacity"]')!
    .addEventListener(
      'change',
      event => editStyle({ fillOpacity: Number((event.target as HTMLInputElement).value) }),
      { signal: abort.signal },
    );
  objects
    .querySelector<HTMLInputElement>('[aria-label="Drawing font size"]')!
    .addEventListener(
      'change',
      event => editStyle({ fontSize: Number((event.target as HTMLInputElement).value) }),
      { signal: abort.signal },
    );
  objects.querySelector<HTMLInputElement>('[aria-label="Fibonacci levels"]')!.addEventListener(
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
  objects.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button =>
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
            case 'lock':
              chart.execute({ type: 'drawing.update', id: d.id, patch: { locked: !d.locked } });
              break;
            case 'hide':
              chart.execute({ type: 'drawing.update', id: d.id, patch: { visible: !d.visible } });
              break;
            case 'delete':
              chart.execute({ type: 'drawing.remove', id: d.id });
              break;
          }
        }),
      { signal: abort.signal },
    ),
  );
  function renderProperties() {
    const d = selection.selected,
      style = d?.style ?? selection.options.style;
    objects.querySelector('.drawing-property-title')!.textContent = d
      ? (catalog.find(t => t.type === d.type)?.label ?? d.type)
      : 'New drawing defaults';
    objects.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
      button.disabled = !d;
      if (button.dataset.action === 'lock') button.textContent = d?.locked ? 'Unlock' : 'Lock';
      if (button.dataset.action === 'hide') button.textContent = d && !d.visible ? 'Show' : 'Hide';
    });
    const text = objects.querySelector<HTMLTextAreaElement>('textarea')!;
    if (activeElement() !== text) text.value = d?.text ?? selection.options.text;
    objects.querySelector<HTMLInputElement>('[aria-label="Drawing fill opacity"]')!.value = String(
      style.fillOpacity,
    );
    objects.querySelector<HTMLInputElement>('[aria-label="Drawing font size"]')!.value = String(
      style.fontSize,
    );
    objects.querySelector<HTMLElement>('.drawing-levels-field')!.hidden = !d?.type.startsWith('fib-');
    objects.querySelector<HTMLInputElement>('[aria-label="Fibonacci levels"]')!.value =
      d?.levels.join(', ') ?? '';
    const anchors = objects.querySelector('.drawing-anchor-fields')!;
    anchors.replaceChildren();
    const position = isPosition(d);
    objects.querySelector('textarea')!.closest('label')!.hidden = position;
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
          datetime.step = '0.001';
          datetime.setAttribute('aria-label', `${name} time UTC`);
          datetime.title = 'UTC';
          datetime.value = new Date(anchor.timeMs).toISOString().slice(0, 23);
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
    objects.querySelector('#drawing-hide-all')!.textContent = selection.options.hidden
      ? 'Show all'
      : 'Hide all';
    objects
      .querySelector('#drawing-hide-all')!
      .setAttribute('aria-pressed', String(selection.options.hidden));
    const locked = !!drawings.length && drawings.every(d => d.locked);
    objects.querySelector('#drawing-lock-all')!.textContent = locked ? 'Unlock all' : 'Lock all';
    objects.querySelector('#drawing-lock-all')!.setAttribute('aria-pressed', String(locked));
    if (!drawings.length) {
      const p = owner.createElement('p');
      p.className = 'drawing-empty';
      p.textContent = 'No drawings yet. Choose a tool from the left toolbar.';
      list.append(p);
    }
    for (const [index, d] of [...drawings].reverse().entries()) {
      const row = owner.createElement('div');
      row.className = `drawing-object-row${d.id === selection.selected?.id ? ' selected' : ''}`;
      const label = catalog.find(t => t.type === d.type)?.label ?? `Unsupported: ${d.type}`,
        number = drawings.length - index;
      const pick = owner.createElement('button');
      pick.className = 'drawing-object-name';
      pick.textContent = `${label} ${number}`;
      pick.style.setProperty('--drawing-color', d.style.color);
      pick.setAttribute('aria-label', `Select ${label.toLowerCase()} ${number}`);
      pick.addEventListener('click', () => chart.selectDrawing(d.id), { signal: abort.signal });
      const hide = owner.createElement('button');
      hide.innerHTML = svg(d.visible ? 'eye' : 'eye-off', 16);
      hide.title = d.visible ? 'Hide' : 'Show';
      hide.setAttribute('aria-label', `${d.visible ? 'Hide' : 'Show'} ${label.toLowerCase()} ${number}`);
      hide.addEventListener(
        'click',
        () => chart.execute({ type: 'drawing.update', id: d.id, patch: { visible: !d.visible } }),
        { signal: abort.signal },
      );
      const lock = owner.createElement('button');
      lock.innerHTML = svg(d.locked ? 'lock' : 'unlock', 16);
      lock.title = d.locked ? 'Unlock' : 'Lock';
      lock.setAttribute('aria-label', `${d.locked ? 'Unlock' : 'Lock'} ${label.toLowerCase()} ${number}`);
      lock.addEventListener(
        'click',
        () => chart.execute({ type: 'drawing.update', id: d.id, patch: { locked: !d.locked } }),
        { signal: abort.signal },
      );
      row.append(pick, hide, lock);
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
    strip.querySelector<HTMLSelectElement>('[aria-label="Drawing line width"]')!.hidden = textOnly;
    strip.querySelector<HTMLSelectElement>('[aria-label="Drawing line style"]')!.hidden = textOnly;
    const style = value.selected?.style ?? value.options.style;
    const hex = style.color.slice(1);
    strip.querySelector<HTMLInputElement>('input')!.value =
      hex.length <= 4 ? `#${[...hex.slice(0, 3)].map(c => c + c).join('')}` : `#${hex.slice(0, 6)}`;
    const widthSelect = strip.querySelector<HTMLSelectElement>('[aria-label="Drawing line width"]')!;
    if (![...widthSelect.options].some(option => Number(option.value) === style.width)) {
      widthSelect.querySelector('[data-custom]')?.remove();
      const option = root.ownerDocument.createElement('option');
      option.dataset.custom = '';
      option.value = String(style.width);
      option.textContent = `${style.width} px`;
      widthSelect.append(option);
    }
    widthSelect.value = String(style.width);
    strip.querySelector<HTMLSelectElement>('[aria-label="Drawing line style"]')!.value = style.lineStyle;
    strip.querySelector<HTMLSelectElement>('[aria-label="Drawing magnet"]')!.value = value.options.magnet;
    strip
      .querySelector('[aria-label="Stay in drawing mode"]')!
      .setAttribute('aria-pressed', String(value.options.stayInDrawingMode));
    renderObjects();
    if (!objects.hidden) renderProperties();
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
      groupHolder.remove();
      redo.remove();
    },
  };
}
