import { createPositionEditor } from './position-editor.ts';
import { isPosition, positionMetrics } from './position-drawing.ts';
import type { ChartApi } from './chart.ts';
import { activeChart } from './chart-switch.ts';
import type { ChartCommand, RuntimeState } from './types.ts';
import { drawingTree, MAX_GROUP_NAME_LENGTH, treeMoveCommands } from './drawing-groups.ts';
import type {
  Drawing,
  DrawingGroup,
  DrawingInteractionState,
  DrawingLevelStyle,
  DrawingOptionValue,
  DrawingSetting,
  DrawingStyle,
  DrawingToolDefaults,
  DrawingToolDefinition,
  DrawingVisibilityRange,
  DrawingVisibilityUnit,
} from './drawing-types.ts';
import {
  drawingTemplatePatch,
  drawingTemplateValue,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATES_PER_TOOL,
  type DrawingTemplates,
} from './drawing-templates.ts';
import { isChartError } from './errors.ts';

import { createDrawingTextEditor } from './drawing-text-editor.ts';
import { uiIcon as svg } from './ui-icons.ts';
import { DRAWING_HOTKEYS, fibDefaultLevels, usesDrawingLevels } from './drawing-tools.ts';
import { drawingOption, fibLevelColor } from './drawing-primitives.ts';
import { defineSelect, type CfSelectElement } from './select.ts';
import { createFavouritesToolbar, type DrawingFavourites } from './drawing-favourites.ts';
import { renderVisibilityFields } from './drawing-visibility-form.ts';
import { visibleOnInterval } from './drawing-visibility.ts';
import { intervalLabel, type Interval } from './intervals.ts';

const FAMILIES = ['Lines', 'Fib & Gann', 'Patterns', 'Forecasting', 'Shapes', 'Annotations'];
/** Line widths offered in the drawing toolbar, in pixels. */
const LINE_WIDTHS = [1, 2, 3, 5, 8];
/** The most levels a drawing holds, as the registry allows. */
const MAX_LEVELS = 24;
const replaced = <T>(list: readonly T[], index: number, value: T) =>
  list.map((item, i) => (i === index ? value : item));
const without = <T>(list: readonly T[], index: number) => list.filter((_, i) => i !== index);
/** A colour input needs six hex digits. */
const pickerColor = (color: string) => {
  const hex = color.slice(1);
  return hex.length <= 4 ? `#${[...hex.slice(0, 3)].map(c => c + c).join('')}` : `#${hex.slice(0, 6)}`;
};

export interface DrawingWorkbenchElements {
  root: HTMLElement;
  rail: HTMLElement;
  panel: HTMLElement;
  /** Named templates and saved tool defaults; the widget owns their storage. */
  templates: DrawingTemplates;
  /** Favourite tools for the family menus' stars and the floating toolbar. */
  favourites?: DrawingFavourites;
  report(message: string): void;
}

/** Instance-owned controls. The widget supplies layout, styles and the chart instance. */
export function createDrawingWorkbench(
  chart: ChartApi,
  { root, rail, panel, templates, favourites, report }: DrawingWorkbenchElements,
) {
  const owner = root.ownerDocument;
  defineSelect(owner.defaultView?.customElements);
  const tree = root.getRootNode() as ShadowRoot | Document;
  const activeElement = () => tree.activeElement;
  const catalog = chart.drawingTools();
  // The familiar rail order; custom families follow in catalog order.
  const groups = [
    ...new Set([...FAMILIES.filter(f => catalog.some(t => t.group === f)), ...catalog.map(t => t.group)]),
  ];
  const abort = new AbortController();
  const flyout = owner.createElement('section');
  flyout.className = 'drawing-flyout';
  flyout.hidden = true;
  flyout.setAttribute('aria-label', 'Choose drawing tool');
  flyout.innerHTML = `<div class="drawing-tool-list" role="menu"></div>`;
  root.append(flyout);
  /**
   * Popups open in the top layer where the browser supports it, so overlays a host stacks
   * over the widget, such as the demo's order ticket, cannot cover them. They are then fixed
   * to the viewport, and `frame` shifts their root- or panel-relative coordinates there.
   */
  const topLayer = typeof flyout.showPopover === 'function';
  function reveal(popup: HTMLElement, open: boolean) {
    popup.hidden = !open;
    if (!topLayer || !popup.isConnected) return;
    if (open !== popup.matches(':popover-open')) popup[open ? 'showPopover' : 'hidePopover']();
  }
  function frame(box: HTMLElement) {
    if (!topLayer) return { left: 0, top: 0, right: 0, bottom: 0 };
    const b = box.getBoundingClientRect(),
      view = owner.documentElement;
    return {
      left: b.left + box.clientLeft,
      top: b.top + box.clientTop,
      right: view.clientWidth - b.right,
      bottom: view.clientHeight - b.bottom,
    };
  }
  const toolList = flyout.querySelector<HTMLElement>('.drawing-tool-list')!;
  let openGroup = groups[0],
    lastDrawings: readonly Drawing[] | undefined,
    lastInterval = chart.inspect().feed.interval as string,
    lastGroups: readonly DrawingGroup[] | undefined,
    /** Group rows folded in the Objects tree. View state, kept for the widget session. */
    collapsed = new Set<string>(),
    renaming: { id: string; draft: string } | null = null,
    lastHistory = '',
    selection: DrawingInteractionState = chart.drawingState();
  const buttons = new Map<string, HTMLButtonElement>(),
    moreButtons = new Map<string, HTMLButtonElement>();
  function closeTools() {
    reveal(flyout, false);
    buttons.forEach(b => b.setAttribute('aria-expanded', 'false'));
    moreButtons.forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  /** Runs one command, or a batch as a single undo step. */
  function run(commands: ChartCommand[]) {
    if (commands.length) chart.execute(commands.length === 1 ? commands[0] : commands);
  }
  /** True while several drawings are selected; the strip then edits all of them. */
  const many = () => selection.selection.length > 1;
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
      lastTool.set(tool.group, tool);
      showLast(tool.group);
      closeTools();
      report(`${tool.label}: ${tool.hint}`);
      activeChart(panel)?.focus({ preventScroll: true });
    });
  }
  function positionTools(button: HTMLElement) {
    const bounds = root.getBoundingClientRect(),
      anchor = button.getBoundingClientRect(),
      edge = frame(root);
    flyout.style.maxHeight = `${Math.max(0, root.clientHeight - 16)}px`;
    if (topLayer) flyout.style.maxWidth = `${Math.max(0, root.clientWidth - 16)}px`;
    // Beside the rail, with the first row level with the button.
    flyout.style.left = `${edge.left + Math.max(8, Math.min(anchor.right - bounds.left - root.clientLeft + 6, root.clientWidth - flyout.offsetWidth - 8))}px`;
    flyout.style.top = `${edge.top + Math.max(8, Math.min(anchor.top - bounds.top - root.clientTop - 4, root.clientHeight - flyout.offsetHeight - 8))}px`;
  }
  const hotkeys = new Map(
    Object.entries(DRAWING_HOTKEYS).map(([code, type]) => [type, `Alt + ${code.slice(3)}`]),
  );
  function listTools() {
    toolList.replaceChildren();
    let section: string | undefined;
    const inGroup = catalog.filter(t => t.group === openGroup),
      sections = [...new Set(inGroup.map(t => t.section))];
    // Tools registered later still list under their section's heading.
    for (const t of sections.flatMap(name => inGroup.filter(t => t.section === name))) {
      if (t.section && t.section !== section) {
        const heading = owner.createElement('div');
        heading.className = 'drawing-tool-section';
        heading.setAttribute('role', 'presentation');
        heading.textContent = t.section;
        toolList.append(heading);
      }
      section = t.section;
      const b = owner.createElement('button');
      b.className = 'drawing-tool-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(selection.tool === t.type));
      b.innerHTML = `${svg(t.type, 18)}<span></span>`;
      b.querySelector('span')!.textContent = t.label;
      const key = hotkeys.get(t.type);
      if (key) {
        const kbd = owner.createElement('kbd');
        kbd.textContent = key;
        b.append(kbd);
      }
      b.title = t.hint;
      b.addEventListener('click', () => choose(t), { signal: abort.signal });
      toolList.append(favourites ? favouriteRow(t, b) : b);
    }
  }
  /** Wraps a menu item with its favourite star; ArrowRight and ArrowLeft move between them. */
  function favouriteRow(t: DrawingToolDefinition, item: HTMLButtonElement) {
    const row = owner.createElement('div');
    row.className = 'drawing-tool-row';
    row.setAttribute('role', 'none');
    const star = owner.createElement('button');
    star.className = 'drawing-tool-star';
    star.tabIndex = -1;
    star.setAttribute('role', 'menuitemcheckbox');
    const show = () => {
      const on = favourites!.has(t.type);
      star.innerHTML = svg(on ? 'star-filled' : 'star', 16);
      star.setAttribute('aria-checked', String(on));
      star.setAttribute(
        'aria-label',
        on ? `Remove ${t.label} from favourites` : `Add ${t.label} to favourites`,
      );
      star.dataset.tooltip = on ? 'Remove from favourites' : 'Add to favourites';
    };
    show();
    star.addEventListener(
      'click',
      () => {
        report(
          favourites!.toggle(t.type)
            ? `Added ${t.label} to favourites`
            : `Removed ${t.label} from favourites`,
        );
        show();
      },
      { signal: abort.signal },
    );
    row.append(item, star);
    return row;
  }
  const items = () => [...toolList.querySelectorAll<HTMLButtonElement>('.drawing-tool-item')];
  toolList.addEventListener(
    'keydown',
    event => {
      const focused = activeElement() as HTMLElement | null,
        onStar = !!focused?.classList.contains('drawing-tool-star'),
        row = focused?.closest('.drawing-tool-row');
      if (row && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        row
          .querySelector<HTMLElement>(
            event.key === 'ArrowRight' ? '.drawing-tool-star' : '.drawing-tool-item',
          )
          ?.focus({ preventScroll: true });
        return;
      }
      // Up and down keep to the column that has focus: tools or their stars.
      const list = onStar ? [...toolList.querySelectorAll<HTMLButtonElement>('.drawing-tool-star')] : items(),
        index = list.indexOf(focused as HTMLButtonElement);
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
  /** Each family's rail button holds its last-used tool, like the familiar drawing rail. */
  const lastTool = new Map(groups.map(group => [group, catalog.find(t => t.group === group)!]));
  function openTools(group: string, b: HTMLElement) {
    const wasOpen = !flyout.hidden && openGroup === group;
    closeTools();
    if (wasOpen) return;
    openGroup = group;
    flyout.setAttribute('aria-label', `${group} tools`);
    reveal(flyout, true);
    b.setAttribute('aria-expanded', 'true');
    listTools();
    positionTools(b);
    (items().find(item => item.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus({
      preventScroll: true,
    });
  }
  function showLast(group: string) {
    const b = buttons.get(group)!,
      t = lastTool.get(group)!;
    b.querySelector('.drawing-group-icon')!.innerHTML = svg(t.type);
    b.dataset.tooltip = t.label;
    b.setAttribute('aria-label', t.label);
  }
  for (const group of groups) {
    const holder = owner.createElement('div');
    holder.className = 'drawing-group';
    const b = owner.createElement('button');
    b.className = 'rail-button drawing-group-button';
    b.innerHTML = '<span class="drawing-group-icon"></span>';
    b.addEventListener('click', () => choose(lastTool.get(group)!), { signal: abort.signal });
    const more = owner.createElement('button');
    more.className = 'drawing-group-more';
    more.setAttribute('aria-label', `${group} tools`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'drawing-tool-picker');
    more.dataset.tooltip = `${group} tools`;
    more.addEventListener('click', () => openTools(group, b), { signal: abort.signal });
    // Right-click or Shift+F10 on the tool also opens the family menu.
    b.addEventListener(
      'contextmenu',
      event => {
        event.preventDefault();
        openTools(group, b);
      },
      { signal: abort.signal },
    );
    buttons.set(group, b);
    moreButtons.set(group, more);
    holder.append(b, more);
    groupHolder.append(holder);
    showLast(group);
  }
  flyout.id = 'drawing-tool-picker';
  rail.querySelector('#trend')?.replaceWith(groupHolder);
  const favouriteBar = favourites && createFavouritesToolbar({ panel, catalog, favourites, choose });
  const favouriteToggle = owner.createElement('button');
  favouriteToggle.className = 'rail-button drawing-favourites-toggle';
  favouriteToggle.innerHTML = svg('star');
  favouriteToggle.hidden = !favourites;
  groupHolder.after(favouriteToggle);
  function showFavouriteToggle() {
    if (!favourites) return;
    const any = favourites.tools().some(type => catalog.some(t => t.type === type)),
      on = favourites.visible;
    favouriteToggle.disabled = !any;
    favouriteToggle.setAttribute('aria-pressed', String(any && on));
    favouriteToggle.setAttribute('aria-label', on ? 'Hide favourites toolbar' : 'Show favourites toolbar');
    favouriteToggle.dataset.tooltip = !any
      ? 'Star a tool in a menu to add favourites'
      : on
        ? 'Hide favourites'
        : 'Show favourites';
    favouriteToggle.innerHTML = svg(any && on ? 'star-filled' : 'star');
  }
  const unsubscribeFavourites = favourites?.subscribe(showFavouriteToggle);
  showFavouriteToggle();
  favouriteToggle.addEventListener('click', () => favourites?.setVisible(!favourites.visible), {
    signal: abort.signal,
  });
  root.addEventListener(
    'pointerdown',
    event => {
      if (!flyout.contains(event.target as Node) && !groupHolder.contains(event.target as Node)) closeTools();
      if (
        !templateMenu.contains(event.target as Node) &&
        !templateButtons.some(b => b.contains(event.target as Node))
      )
        closeTemplates();
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && !templateMenu.hidden) {
        const trigger = templateTrigger;
        closeTemplates();
        trigger?.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Escape' && !flyout.hidden) {
        closeTools();
        moreButtons.get(openGroup)?.focus({ preventScroll: true });
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
      if (!root.contains(event.relatedTarget as Node | null)) {
        closeTools();
        closeTemplates();
      }
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
  strip.innerHTML = `<span class="drawing-active-tool">Cursor</span><label title="Stroke color"><span class="sr-only">Drawing color</span><input type="color" aria-label="Drawing color" value="#a9c4ff"></label><cf-select aria-label="Drawing line width" search="off"><option value="1">1 px</option><option value="2" selected>2 px</option><option value="3">3 px</option><option value="5">5 px</option><option value="8">8 px</option></cf-select><cf-select aria-label="Drawing line style" search="off"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></cf-select><span class="drawing-strip-divider"></span><cf-select aria-label="Drawing magnet" search="off"><option value="off">Magnet off</option><option value="weak">Weak magnet</option><option value="strong">Strong magnet</option></cf-select><button aria-label="Stay in drawing mode" aria-pressed="false" data-tooltip="Keep drawing">${svg('keep', 18)}</button><span class="drawing-strip-divider"></span><button class="drawing-template-button" aria-label="Drawing templates" aria-haspopup="dialog" aria-expanded="false" aria-controls="drawing-templates" data-tooltip="Template">${svg('template', 18)}</button><button class="drawing-settings-button" aria-label="Drawing settings" aria-expanded="false" aria-controls="drawing-settings" data-tooltip="Settings">${svg('settings', 18)}</button><button class="drawing-lock-button" aria-label="Lock drawing" aria-pressed="false" data-tooltip="Lock">${svg('unlock', 18)}</button><button class="drawing-delete-button" aria-label="Delete drawing" data-tooltip="Delete">${svg('trash', 18)}</button>`;
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
  objectToggle.className = 'rail-button drawing-objects-button';
  objectToggle.innerHTML = `${svg('layers')}<span hidden>0</span>`;
  objectToggle.setAttribute('aria-label', 'Drawing objects');
  objectToggle.setAttribute('aria-expanded', 'false');
  objectToggle.dataset.tooltip = 'Drawing objects';
  // With the drawing tools: the list holds what they made.
  favouriteToggle.after(objectToggle);
  const objects = owner.createElement('section');
  objects.className = 'drawing-object-panel';
  objects.hidden = true;
  objects.setAttribute('aria-label', 'Drawing objects and properties');
  objects.innerHTML = `<div class="drawing-panel-heading"><strong>Drawings</strong><span class="drawing-heading-actions"><button id="drawing-group" aria-label="Group selected drawings" title="Group selection">${svg('group', 16)}</button><button id="drawing-hide-all" aria-pressed="false" aria-label="Hide all drawings" title="Hide all">${svg('eye', 16)}</button><button id="drawing-lock-all" aria-pressed="false" aria-label="Lock all drawings" title="Lock all">${svg('unlock', 16)}</button><button class="drawing-close" aria-label="Close drawing objects">${svg('close', 16)}</button></span></div><div class="drawing-object-list"></div>`;
  const settings = owner.createElement('section');
  settings.className = 'drawing-settings';
  settings.id = 'drawing-settings';
  settings.hidden = true;
  settings.setAttribute('aria-label', 'Drawing settings');
  settings.innerHTML = `<div class="drawing-panel-heading"><strong class="drawing-property-title">Defaults</strong><button class="drawing-close" aria-label="Close drawing settings">${svg('close', 16)}</button></div><div class="drawing-properties"><label>Text<textarea aria-label="Drawing text" maxlength="2000" rows="2"></textarea></label><div class="drawing-property-row"><label>Fill opacity<input aria-label="Drawing fill opacity" type="number" min="0" max="1" step="0.05"></label><label>Font size<input aria-label="Drawing font size" type="number" min="10" max="32" step="1"></label></div><div class="drawing-option-fields"></div><div class="drawing-anchor-fields"></div><div class="drawing-selected-actions"><button data-action="duplicate">Duplicate</button><button data-action="front">Bring to front</button><button data-action="back">Send to back</button></div><div class="drawing-template-footer"><button class="button drawing-template-open" aria-haspopup="dialog" aria-expanded="false" aria-controls="drawing-templates">Template${svg('chevron', 14)}</button></div></div>`;
  panel.append(settings);
  panel.append(objects);
  const visibilityFields = owner.createElement('div');
  visibilityFields.className = 'drawing-visibility-fields';
  settings.querySelector('.drawing-anchor-fields')!.before(visibilityFields);
  /** The chart's interval as the picker names it, for hidden-drawing hints. */
  function intervalName() {
    try {
      return intervalLabel(lastInterval as Interval);
    } catch {
      return lastInterval;
    }
  }
  // Visibility is per drawing; it reaches new drawings only through defaults and templates.
  function editVisibility(unit: DrawingVisibilityUnit, range: DrawingVisibilityRange) {
    attempt(() => {
      const visibility = { [unit]: range };
      if (selection.selected)
        chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { visibility } });
      else remember({ visibility });
    });
  }
  function positionObjects() {
    // Beside the rail, level with its toggle.
    const bounds = panel.getBoundingClientRect(),
      anchor = objectToggle.getBoundingClientRect();
    const top = Math.max(8, Math.min(anchor.top - bounds.top - panel.clientTop, panel.clientHeight - 160)),
      edge = frame(panel);
    objects.style.top = `${edge.top + top}px`;
    objects.style.left = `${edge.left + 8}px`;
    objects.style.maxHeight = `${Math.max(0, panel.clientHeight - top - 8)}px`;
    if (topLayer) objects.style.maxWidth = `${Math.max(0, panel.clientWidth - 16)}px`;
  }
  function toggleObjects(open: boolean) {
    reveal(objects, open);
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
    const bottom = bounds.bottom - anchor.top + 6,
      edge = frame(panel);
    settings.style.bottom = `${edge.bottom + bottom}px`;
    if (topLayer) {
      settings.style.left = `${edge.left + panel.clientWidth / 2}px`;
      settings.style.maxWidth = `${Math.max(0, panel.clientWidth - 20)}px`;
    }
    settings.style.maxHeight = `${Math.max(0, panel.clientHeight - bottom - 8)}px`;
  }
  function toggleSettings(open: boolean) {
    if (!open && templateTrigger === settings.querySelector('.drawing-template-open')) closeTemplates();
    reveal(settings, open);
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
        const all = selection.selection,
          locked = !all.every(d => d.locked);
        run(all.map(d => ({ type: 'drawing.update', id: d.id, patch: { locked } })));
      }),
    { signal: abort.signal },
  );
  strip
    .querySelector('.drawing-delete-button')!
    .addEventListener(
      'click',
      () =>
        attempt(() =>
          run(selection.selection.filter(d => !d.locked).map(d => ({ type: 'drawing.remove', id: d.id }))),
        ),
      { signal: abort.signal },
    );
  /** The tool whose defaults an edit should update: the selection's, else the active tool. */
  const editedType = () =>
    many() ? null : (selection.selected?.type ?? (selection.tool === 'cursor' ? null : selection.tool));
  /** Sets a tool's defaults on every chart and saves them; `null` returns it to the built-in look. */
  function setDefaults(type: string, value: DrawingToolDefaults | null) {
    chart.setDrawingOptions({ toolDefaults: { [type]: value } });
    templates.setDefault(type, value);
  }
  // Edits stick to the tool, so its next drawing starts with the last-used look.
  function remember(patch: DrawingToolDefaults) {
    const type = editedType();
    if (!type || !catalog.some(t => t.type === type)) return;
    const current = selection.options.toolDefaults[type];
    setDefaults(type, {
      style: { ...current?.style, ...patch.style },
      options: { ...current?.options, ...patch.options },
      levels: patch.levels ?? current?.levels,
      visibility: patch.visibility ? { ...current?.visibility, ...patch.visibility } : current?.visibility,
      levelStyles: patch.levelStyles ?? current?.levelStyles,
    });
  }
  function editStyle(patch: Partial<DrawingStyle>) {
    attempt(() => {
      if (selection.selection.length)
        run(selection.selection.map(d => ({ type: 'drawing.update', id: d.id, patch: { style: patch } })));
      else if (selection.tool === 'cursor') chart.setDrawingOptions({ style: patch });
      remember({ style: patch });
    });
  }
  function editOption(key: string, value: DrawingOptionValue) {
    attempt(() => {
      if (selection.selected)
        chart.execute({
          type: 'drawing.update',
          id: selection.selected.id,
          patch: { options: { [key]: value } },
        });
      remember({ options: { [key]: value } });
    });
  }
  const templateMenu = owner.createElement('section');
  templateMenu.className = 'drawing-template-menu';
  templateMenu.id = 'drawing-templates';
  templateMenu.hidden = true;
  templateMenu.setAttribute('aria-label', 'Drawing templates');
  templateMenu.tabIndex = -1;
  panel.append(templateMenu);
  if (topLayer) for (const popup of [flyout, objects, settings, templateMenu]) popup.popover = 'manual';
  const templateButtons = [
    strip.querySelector<HTMLButtonElement>('.drawing-template-button')!,
    settings.querySelector<HTMLButtonElement>('.drawing-template-open')!,
  ];
  let templateTrigger: HTMLButtonElement | null = null,
    templateMode: 'menu' | 'save' | 'replace' | 'rename' = 'menu',
    /** The template being renamed. */
    templateRenaming = '',
    templateDraft = '',
    templateError = '';
  /** The tool a template action reads or writes, and the look it has now. */
  function templateTarget() {
    const type = editedType(),
      tool = catalog.find(t => t.type === type),
      drawing = selection.selected;
    if (!type || !tool) return null;
    const remembered = selection.options.toolDefaults[type];
    // The look a new drawing of this tool would get.
    const defaults = { ...remembered, style: { ...selection.options.style, ...remembered?.style } };
    return { type, tool, drawing, defaults, value: drawing ? drawingTemplateValue(drawing, tool) : defaults };
  }
  function closeTemplates() {
    reveal(templateMenu, false);
    templateTrigger = null;
    templateMode = 'menu';
    templateDraft = templateError = templateRenaming = '';
    templateButtons.forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function positionTemplates() {
    if (!templateTrigger) return;
    const bounds = panel.getBoundingClientRect(),
      anchor = templateTrigger.getBoundingClientRect();
    const bottom = bounds.bottom - anchor.top + 6,
      edge = frame(panel);
    templateMenu.style.bottom = `${edge.bottom + bottom}px`;
    templateMenu.style.maxHeight = `${Math.max(0, panel.clientHeight - bottom - 8)}px`;
    if (topLayer)
      templateMenu.style.maxWidth = `min(calc(var(--ui-size) * 22), ${Math.max(0, panel.clientWidth - 16)}px)`;
    templateMenu.style.left = `${edge.left + Math.max(8, Math.min(anchor.left - bounds.left, panel.clientWidth - templateMenu.offsetWidth - 8))}px`;
  }
  function openTemplates(trigger: HTMLButtonElement) {
    const wasOpen = !templateMenu.hidden && templateTrigger === trigger;
    closeTemplates();
    if (wasOpen) return;
    closeTools();
    templateTrigger = trigger;
    reveal(templateMenu, true);
    trigger.setAttribute('aria-expanded', 'true');
    renderTemplates();
    positionTemplates();
    templateMenu.querySelector<HTMLElement>('.drawing-tool-item')?.focus({ preventScroll: true });
  }
  /** Gives the selection `value`'s look in one undo step, or makes it the tool's next look. */
  function applyLook(value: DrawingToolDefaults | null, message: string) {
    const target = templateTarget();
    if (!target) return;
    attempt(() => {
      if (target.drawing)
        chart.execute({
          type: 'drawing.update',
          id: target.drawing.id,
          patch: drawingTemplatePatch(target.tool, value),
        });
      else setDefaults(target.type, value);
      closeTemplates();
      report(message);
    });
  }
  function saveTemplate(replace: boolean) {
    const target = templateTarget();
    if (!target) return;
    try {
      const saved = templates.save(target.type, templateDraft, target.value, replace);
      closeTemplates();
      report(`Saved template "${saved.name}"`);
    } catch (error) {
      if (isChartError(error, 'TEMPLATE_EXISTS')) templateMode = 'replace';
      else
        templateError = isChartError(error, 'INVALID_TEMPLATE_NAME')
          ? `Enter a name of up to ${MAX_TEMPLATE_NAME_LENGTH} characters.`
          : isChartError(error, 'TEMPLATE_LIMIT')
            ? `${target.tool.label} has ${MAX_TEMPLATES_PER_TOOL} templates. Delete one first.`
            : error instanceof Error
              ? error.message.replaceAll('_', ' ')
              : String(error);
      renderTemplates();
    }
  }
  function renameTemplate() {
    const target = templateTarget();
    if (!target) return;
    try {
      const renamed = templates.rename(target.type, templateRenaming, templateDraft);
      templateMode = 'menu';
      templateDraft = templateError = templateRenaming = '';
      renderTemplates();
      report(`Renamed template to "${renamed.name}"`);
      templateMenu
        .querySelector<HTMLElement>(`[aria-label="Apply template ${CSS.escape(renamed.name)}"]`)
        ?.focus({ preventScroll: true });
    } catch (error) {
      templateError = isChartError(error, 'TEMPLATE_EXISTS')
        ? `${target.tool.label} already has a template with that name.`
        : isChartError(error, 'INVALID_TEMPLATE_NAME')
          ? `Enter a name of up to ${MAX_TEMPLATE_NAME_LENGTH} characters.`
          : error instanceof Error
            ? error.message.replaceAll('_', ' ')
            : String(error);
      renderTemplates();
    }
  }
  function renderTemplates() {
    const target = templateTarget();
    if (!target) return closeTemplates();
    // Focus would fall out of the widget with the removed row and close the menu.
    if (templateMenu.contains(activeElement())) templateMenu.focus({ preventScroll: true });
    templateMenu.replaceChildren();
    const item = (label: string, action: () => void) => {
      const b = owner.createElement('button');
      b.className = 'drawing-tool-item';
      b.textContent = label;
      b.addEventListener('click', action, { signal: abort.signal });
      return b;
    };
    const heading = owner.createElement('div');
    heading.className = 'drawing-tool-section';
    heading.textContent =
      templateMode === 'rename' ? `Rename "${templateRenaming}"` : `${target.tool.label} templates`;
    templateMenu.append(heading);
    if (templateMode !== 'menu') {
      const form = owner.createElement('form');
      form.className = 'drawing-template-form';
      if (templateMode === 'save' || templateMode === 'rename') {
        const input = owner.createElement('input');
        input.value = templateDraft;
        input.maxLength = MAX_TEMPLATE_NAME_LENGTH;
        input.placeholder = 'Template name';
        input.setAttribute('aria-label', templateMode === 'rename' ? 'New template name' : 'Template name');
        input.addEventListener('input', () => (templateDraft = input.value), { signal: abort.signal });
        input.addEventListener(
          'keydown',
          event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            templateMode = 'menu';
            templateError = '';
            renderTemplates();
            templateMenu.querySelector<HTMLElement>('.drawing-tool-item')?.focus({ preventScroll: true });
          },
          { signal: abort.signal },
        );
        form.append(input);
        queueMicrotask(() => {
          if (!input.isConnected) return;
          input.focus({ preventScroll: true });
          if (templateMode === 'rename') input.select();
        });
      } else {
        const question = owner.createElement('p');
        question.textContent = `Replace "${templates.find(target.type, templateDraft)?.name ?? templateDraft.trim()}"?`;
        form.append(question);
      }
      if (templateError) {
        const error = owner.createElement('p');
        error.className = 'drawing-template-error';
        error.setAttribute('role', 'alert');
        error.textContent = templateError;
        form.append(error);
      }
      const actions = owner.createElement('div');
      actions.className = 'drawing-template-actions';
      const submit = owner.createElement('button');
      submit.type = 'submit';
      submit.className = 'button primary';
      submit.textContent =
        templateMode === 'save' ? 'Save' : templateMode === 'rename' ? 'Rename' : 'Replace';
      const cancel = owner.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener(
        'click',
        () => {
          templateMode = templateMode === 'replace' ? 'save' : 'menu';
          templateError = '';
          renderTemplates();
          if (templateMode === 'menu')
            templateMenu.querySelector<HTMLElement>('.drawing-tool-item')?.focus({ preventScroll: true });
        },
        { signal: abort.signal },
      );
      actions.append(submit, cancel);
      form.append(actions);
      form.addEventListener(
        'submit',
        event => {
          event.preventDefault();
          if (templateMode === 'rename') renameTemplate();
          else saveTemplate(templateMode === 'replace');
        },
        { signal: abort.signal },
      );
      templateMenu.append(form);
      if (templateMode === 'replace')
        queueMicrotask(() => submit.isConnected && submit.focus({ preventScroll: true }));
      return;
    }
    templateMenu.append(
      item('Save as…', () => {
        templateMode = 'save';
        renderTemplates();
      }),
    );
    if (target.drawing)
      templateMenu.append(
        item('Save as default', () =>
          attempt(() => {
            setDefaults(target.type, target.value);
            closeTemplates();
            report(`Saved as the ${target.tool.label.toLowerCase()} default`);
          }),
        ),
      );
    const list = owner.createElement('div');
    list.className = 'drawing-template-list';
    for (const template of templates.list(target.type)) {
      const row = owner.createElement('div');
      row.className = 'drawing-template-row';
      const { name, ...look } = template;
      const apply = item(name, () => applyLook(look, `Applied template "${name}"`));
      apply.setAttribute('aria-label', `Apply template ${name}`);
      const rename = owner.createElement('button');
      rename.className = 'drawing-template-delete drawing-template-rename';
      rename.innerHTML = svg('edit', 15);
      rename.setAttribute('aria-label', `Rename template ${name}`);
      rename.title = 'Rename';
      rename.addEventListener(
        'click',
        () => {
          templateMode = 'rename';
          templateRenaming = templateDraft = name;
          templateError = '';
          renderTemplates();
        },
        { signal: abort.signal },
      );
      const remove = owner.createElement('button');
      remove.className = 'drawing-template-delete';
      remove.innerHTML = svg('trash', 15);
      remove.setAttribute('aria-label', `Delete template ${name}`);
      remove.title = 'Delete';
      remove.addEventListener(
        'click',
        () =>
          attempt(() => {
            const rows = [...templateMenu.querySelectorAll('.drawing-template-row')],
              index = rows.indexOf(row);
            templates.remove(target.type, name);
            renderTemplates();
            report(`Deleted template "${name}"`);
            const next = templateMenu.querySelectorAll<HTMLElement>(
              '.drawing-template-row .drawing-tool-item',
            );
            (
              next[Math.min(index, next.length - 1)] ??
              templateMenu.querySelector<HTMLElement>('.drawing-tool-item')
            )?.focus({
              preventScroll: true,
            });
          }),
        { signal: abort.signal },
      );
      row.append(apply, rename, remove);
      list.append(row);
    }
    if (!list.childElementCount) {
      const empty = owner.createElement('p');
      empty.className = 'drawing-empty';
      empty.textContent = 'No saved templates';
      list.append(empty);
    }
    templateMenu.append(list);
    if (target.drawing)
      templateMenu.append(
        item('Apply default', () => applyLook(target.defaults, 'Applied the default style')),
      );
    templateMenu.append(item('Reset', () => applyLook(null, 'Reset to the built-in style')));
  }
  templateButtons.forEach(button =>
    button.addEventListener('click', () => openTemplates(button), { signal: abort.signal }),
  );
  templateMenu.addEventListener(
    'keydown',
    event => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      const list = [...templateMenu.querySelectorAll<HTMLButtonElement>('button')],
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
  objects.querySelector('#drawing-group')!.addEventListener(
    'click',
    () =>
      attempt(() => {
        const id = crypto.randomUUID();
        chart.execute({ type: 'drawing.group', id, drawingIds: selection.selection.map(d => d.id) });
        collapsed.delete(id);
      }),
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
  /** Gives the selection, and the tool's next drawing, these levels and per-level looks. */
  function editLevels(levels: number[], levelStyles: DrawingLevelStyle[]) {
    attempt(() => {
      if (selection.selected)
        chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { levels, levelStyles } });
      remember({ levels, levelStyles });
    });
  }
  /** A drawing's levels, or a tool's next ones, with one look per level. */
  function levelState(d: Drawing | null, type: string) {
    const remembered = selection.options.toolDefaults[type],
      own = d ? d.levels : (remembered?.levels ?? []),
      levels = [...(own.length ? own : fibDefaultLevels(type))],
      looks = levels.map((_, i): DrawingLevelStyle => ({
        ...(d ? d.levelStyles : remembered?.levelStyles)?.[i],
      }));
    return { own, levels, looks };
  }
  /**
   * One row per level, like the familiar levels table: on/off, value and colour. Handlers read
   * the current levels, since a focused table is not rebuilt after each edit.
   */
  function levelTable(d: Drawing | null, type: string, fields: readonly DrawingSetting[]) {
    const { own, levels, looks } = levelState(d, type),
      remembered = selection.options.toolDefaults[type];
    const now = () => levelState(selection.selected, type);
    const lineColor = (d?.style ?? { ...selection.options.style, ...remembered?.style }).color;
    const oneColor =
      drawingOption<boolean>(
        { options: { ...(d ? undefined : remembered?.options), ...d?.options } },
        { settings: fields },
        'levelColors',
      ) === false;
    // Adding or removing a row changes the table's shape, so it is rebuilt before focus moves.
    const reshape = (levels: number[], looks: DrawingLevelStyle[], focus: string) => {
      editLevels(levels, looks);
      renderOptions(fields, selection.selected, true);
      settings.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
    };
    const table = owner.createElement('div');
    table.className = 'drawing-level-table';
    table.setAttribute('role', 'group');
    table.setAttribute('aria-label', 'Fibonacci levels');
    levels.forEach((level, i) => {
      const row = owner.createElement('div');
      row.className = 'drawing-level-row';
      const shown = owner.createElement('input');
      shown.type = 'checkbox';
      shown.checked = looks[i].visible !== false;
      shown.setAttribute('aria-label', `Show level ${i + 1}`);
      shown.addEventListener(
        'change',
        () => {
          const { levels, looks } = now(),
            look = { ...looks[i] };
          if (shown.checked) delete look.visible;
          else look.visible = false;
          editLevels(levels, replaced(looks, i, look));
        },
        { signal: abort.signal },
      );
      const value = owner.createElement('input');
      value.type = 'number';
      value.step = 'any';
      value.min = '-1000';
      value.max = '1000';
      value.value = String(level);
      value.setAttribute('aria-label', `Level ${i + 1} value`);
      value.addEventListener(
        'change',
        () => {
          const { levels, looks } = now();
          editLevels(replaced(levels, i, value.value.trim() ? Number(value.value) : NaN), looks);
        },
        { signal: abort.signal },
      );
      const color = owner.createElement('input');
      color.type = 'color';
      color.value = pickerColor(oneColor ? lineColor : (looks[i].color ?? fibLevelColor(level, i)));
      color.disabled = oneColor;
      color.title = oneColor ? 'Turn on Colour each level to pick level colours' : '';
      color.setAttribute('aria-label', `Level ${i + 1} colour`);
      color.addEventListener(
        'change',
        () => {
          const { levels, looks } = now();
          editLevels(levels, replaced(looks, i, { ...looks[i], color: color.value }));
        },
        { signal: abort.signal },
      );
      const remove = owner.createElement('button');
      remove.type = 'button';
      remove.className = 'drawing-level-remove';
      remove.innerHTML = svg('close', 14);
      remove.setAttribute('aria-label', `Remove level ${i + 1}`);
      remove.title = 'Remove';
      remove.disabled = levels.length <= 1;
      remove.addEventListener(
        'click',
        () => {
          const { levels, looks } = now();
          reshape(without(levels, i), without(looks, i), '.drawing-level-add');
        },
        { signal: abort.signal },
      );
      row.append(shown, value, color, remove);
      table.append(row);
    });
    const actions = owner.createElement('div');
    actions.className = 'drawing-level-actions';
    const add = owner.createElement('button');
    add.type = 'button';
    add.className = 'button drawing-level-add';
    add.textContent = 'Add level';
    add.disabled = levels.length >= MAX_LEVELS;
    add.addEventListener(
      'click',
      () => {
        const { levels, looks } = now();
        reshape(
          [...levels, Number((Math.max(...levels) + 1).toFixed(3))],
          looks,
          '.drawing-level-row:last-child input[type=number]',
        );
      },
      { signal: abort.signal },
    );
    const reset = owner.createElement('button');
    reset.type = 'button';
    reset.className = 'button';
    reset.textContent = 'Reset levels';
    reset.disabled = !own.length && looks.every(look => !Object.keys(look).length);
    reset.addEventListener('click', () => reshape([], [], '.drawing-level-add'), { signal: abort.signal });
    actions.append(add, reset);
    return [table, actions];
  }
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
  function renderOptions(fields: readonly DrawingSetting[], d: Drawing | null, force = false) {
    const holder = settings.querySelector<HTMLElement>('.drawing-option-fields')!;
    // Rebuilding while a field has focus would drop the user's place in the form.
    if (!force && holder.contains(activeElement())) return;
    holder.replaceChildren();
    const type = d?.type ?? selection.tool,
      remembered = selection.options.toolDefaults[type]?.options;
    const current = (field: DrawingSetting) =>
      d?.options?.[field.key] ?? (d ? undefined : remembered?.[field.key]) ?? field.default;
    let section: HTMLElement | null = null,
      title: string | undefined;
    for (const field of fields) {
      if (!section || field.section !== title) {
        title = field.section;
        section = owner.createElement('fieldset');
        section.className = 'drawing-option-section';
        if (title) {
          const legend = owner.createElement('legend');
          legend.textContent = title;
          section.append(legend);
        }
        holder.append(section);
      }
      const label = owner.createElement('label');
      label.className = `drawing-option drawing-option-${field.kind}`;
      const name = owner.createElement('span');
      name.textContent = field.label;
      const value = current(field);
      let control: HTMLElement;
      if (field.kind === 'boolean') {
        const input = owner.createElement('input');
        input.type = 'checkbox';
        input.checked = value === true;
        input.dataset.key = field.key;
        input.addEventListener(
          'change',
          () => {
            editOption(field.key, input.checked);
            // The levels table greys its colours with this switch.
            if (field.key !== 'levelColors') return;
            renderOptions(fields, selection.selected, true);
            holder.querySelector<HTMLElement>('[data-key="levelColors"]')?.focus({ preventScroll: true });
          },
          { signal: abort.signal },
        );
        control = input;
        label.append(control, name);
      } else if (field.kind === 'select') {
        const select = owner.createElement('cf-select') as CfSelectElement;
        select.setAttribute('search', 'off');
        select.setAttribute('aria-label', field.label);
        select.setItems(
          field.choices.map(c => ({ value: c.value, label: c.label })),
          String(value),
        );
        select.addEventListener('change', () => editOption(field.key, select.value), {
          signal: abort.signal,
        });
        control = select;
        label.append(name, control);
      } else {
        const input = owner.createElement('input');
        input.type = field.kind === 'color' ? 'color' : 'number';
        if (field.kind === 'number') {
          input.min = String(field.min);
          input.max = String(field.max);
          input.step = String(field.step ?? 'any');
        }
        // A blank colour follows the drawing's colour; the picker needs six hex digits.
        const shown = String(value || (d?.style ?? selection.options.style).color),
          hex = shown.slice(1);
        input.value =
          field.kind === 'color'
            ? hex.length <= 4
              ? `#${[...hex.slice(0, 3)].map(c => c + c).join('')}`
              : `#${hex.slice(0, 6)}`
            : shown;
        input.addEventListener(
          'change',
          () => editOption(field.key, field.kind === 'number' ? Number(input.value) : input.value),
          { signal: abort.signal },
        );
        control = input;
        label.append(name, control);
      }
      section!.append(label);
    }
    if (usesDrawingLevels(type)) {
      // The table leads the Levels section, or gets its own when a tool has none.
      let levels = [...holder.querySelectorAll('legend')].find(
        l => l.textContent === 'Levels',
      )?.parentElement;
      if (!levels) {
        levels = owner.createElement('fieldset');
        levels.className = 'drawing-option-section';
        levels.innerHTML = '<legend>Levels</legend>';
        holder.prepend(levels);
      }
      levels.querySelector('legend')!.after(...levelTable(d, type, fields));
    }
    holder.hidden = !holder.childElementCount;
  }
  function renderProperties() {
    const d = selection.selected,
      style = d?.style ?? {
        ...selection.options.style,
        ...selection.options.toolDefaults[selection.tool]?.style,
      };
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
    renderOptions(tool?.settings ?? [], d);
    if (d || tool)
      renderVisibilityFields(
        visibilityFields,
        d ? d.visibility : selection.options.toolDefaults[selection.tool]?.visibility,
        editVisibility,
        {
          signal: abort.signal,
          note: d && !visibleOnInterval(d, lastInterval) ? `Hidden on ${intervalName()}` : undefined,
        },
      );
    else visibilityFields.replaceChildren();
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
  /** Selects `ids`, or with Ctrl, Command or Shift adds them, or removes them when all are selected. */
  function pick(ids: string[], event: MouseEvent) {
    const current = selection.selection.map(d => d.id);
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return chart.selectDrawing(ids);
    chart.selectDrawing(
      ids.every(id => current.includes(id))
        ? current.filter(id => !ids.includes(id))
        : [...current.filter(id => !ids.includes(id)), ...ids],
    );
  }
  function rowButton(icon: string, label: string, on: boolean, action: () => void) {
    const b = owner.createElement('button');
    b.className = `drawing-row-action${on ? ' on' : ''}`;
    b.innerHTML = svg(icon, 16);
    b.title = label.split(' ')[0];
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => attempt(action), { signal: abort.signal });
    return b;
  }
  let dragged: string | null = null;
  /** Rows reorder by drag. The drop lands in front of a row's top half or behind its bottom half. */
  function draggable(row: HTMLElement, id: string) {
    row.draggable = true;
    row.dataset.id = id;
    const clear = () =>
      objects
        .querySelectorAll('.drop-before, .drop-after')
        .forEach(r => r.classList.remove('drop-before', 'drop-after'));
    const where = (event: DragEvent) => {
      const box = row.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    };
    row.addEventListener(
      'dragstart',
      event => {
        dragged = id;
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      },
      { signal: abort.signal },
    );
    row.addEventListener(
      'dragover',
      event => {
        if (!dragged || dragged === id) return;
        event.preventDefault();
        clear();
        row.classList.add(`drop-${where(event)}`);
      },
      { signal: abort.signal },
    );
    row.addEventListener('dragleave', clear, { signal: abort.signal });
    row.addEventListener(
      'drop',
      event => {
        event.preventDefault();
        clear();
        const source = dragged;
        dragged = null;
        if (!source) return;
        const doc = chart.exportDocument();
        attempt(() =>
          run(treeMoveCommands(doc.drawings, doc.drawingGroups, source, { target: id, where: where(event) })),
        );
      },
      { signal: abort.signal },
    );
    row.addEventListener(
      'dragend',
      () => {
        dragged = null;
        clear();
        row.classList.remove('dragging');
      },
      { signal: abort.signal },
    );
  }
  function startRename(group: DrawingGroup) {
    renaming = { id: group.id, draft: group.name };
    renderObjects();
  }
  function finishRename(save: boolean) {
    const current = renaming;
    renaming = null;
    const name = current?.draft.trim();
    if (save && current && name && lastGroups?.find(g => g.id === current.id)?.name !== name)
      attempt(() => chart.execute({ type: 'drawing.updateGroup', id: current.id, name }));
    renderObjects();
    objects
      .querySelector<HTMLElement>(`[data-id="${CSS.escape(current?.id ?? '')}"] .drawing-object-name`)
      ?.focus({ preventScroll: true });
  }
  function renderObjects() {
    const list = objects.querySelector('.drawing-object-list')!;
    // Rebuilding would drop the name being typed and its focus.
    const typing = list.querySelector('.drawing-group-rename') === activeElement();
    list.replaceChildren();
    const drawings = lastDrawings ?? [],
      groups = lastGroups ?? [];
    const count = objectToggle.querySelector('span')!;
    count.textContent = String(drawings.length);
    count.hidden = !drawings.length;
    objectToggle.setAttribute('aria-label', `Drawing objects (${drawings.length})`);
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
    objects.querySelector<HTMLButtonElement>('#drawing-group')!.disabled = selection.selection.length < 2;
    if (!drawings.length) {
      const p = owner.createElement('p');
      p.className = 'drawing-empty';
      p.textContent = 'No drawings';
      list.append(p);
    }
    const chosen = new Set(selection.selection.map(d => d.id));
    const drawingRow = (d: Drawing, member: boolean) => {
      const row = owner.createElement('div');
      row.className = `drawing-object-row${chosen.has(d.id) ? ' selected' : ''}${member ? ' member' : ''}`;
      const label = catalog.find(t => t.type === d.type)?.label ?? `Unsupported: ${d.type}`,
        number = drawings.indexOf(d) + 1,
        name = `${label.toLowerCase()} ${number}`;
      const pick_ = owner.createElement('button');
      pick_.className = 'drawing-object-name';
      pick_.innerHTML = svg(d.type, 16);
      const title = owner.createElement('span');
      title.className = 'drawing-object-label';
      title.textContent = `${label} ${number}`;
      pick_.append(title);
      pick_.style.setProperty('--drawing-color', d.style.color);
      // Still listed, so the user can select it and change its Visibility settings.
      const offInterval = d.visible && !visibleOnInterval(d, lastInterval),
        hint = `Hidden on ${intervalName()}`;
      row.classList.toggle('off-interval', offInterval);
      if (offInterval) {
        const small = owner.createElement('small');
        small.className = 'drawing-object-hint';
        small.textContent = hint;
        // The hint sits under the name, so narrow panels keep both readable.
        const text = owner.createElement('span');
        text.className = 'drawing-object-text';
        title.replaceWith(text);
        text.append(title, small);
        pick_.title = `${hint} by its Visibility settings`;
      }
      pick_.setAttribute('aria-label', `Select ${name}${offInterval ? `, ${hint.toLowerCase()}` : ''}`);
      pick_.addEventListener('click', event => pick([d.id], event), { signal: abort.signal });
      row.append(
        pick_,
        rowButton(d.visible ? 'eye' : 'eye-off', `${d.visible ? 'Hide' : 'Show'} ${name}`, !d.visible, () =>
          chart.execute({ type: 'drawing.update', id: d.id, patch: { visible: !d.visible } }),
        ),
        rowButton(d.locked ? 'lock' : 'unlock', `${d.locked ? 'Unlock' : 'Lock'} ${name}`, d.locked, () =>
          chart.execute({ type: 'drawing.update', id: d.id, patch: { locked: !d.locked } }),
        ),
        rowButton('trash', `Delete ${name}`, false, () =>
          chart.execute({ type: 'drawing.remove', id: d.id }),
        ),
      );
      draggable(row, d.id);
      list.append(row);
    };
    for (const item of drawingTree(drawings, groups)) {
      if (item.kind === 'drawing') {
        drawingRow(
          drawings.find(d => d.id === item.id)!,
          false,
        );
        continue;
      }
      const group = groups.find(g => g.id === item.id)!,
        members = item.members.map(id => drawings.find(d => d.id === id)!),
        open = !collapsed.has(group.id),
        allHidden = members.every(d => !d.visible),
        allLocked = members.every(d => d.locked),
        all = members.every(d => chosen.has(d.id));
      const row = owner.createElement('div');
      row.className = `drawing-object-row drawing-group-row${all ? ' selected' : ''}`;
      const fold = owner.createElement('button');
      fold.className = 'drawing-group-fold';
      fold.innerHTML = svg('chevron', 14);
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${group.name}`);
      fold.addEventListener(
        'click',
        () => {
          if (open) collapsed.add(group.id);
          else collapsed.delete(group.id);
          renderObjects();
          objects
            .querySelector<HTMLElement>(`[data-id="${CSS.escape(group.id)}"] .drawing-group-fold`)
            ?.focus({ preventScroll: true });
        },
        { signal: abort.signal },
      );
      let title: HTMLElement;
      if (renaming?.id === group.id) {
        const input = owner.createElement('input');
        input.className = 'drawing-group-rename';
        input.value = renaming.draft;
        input.maxLength = MAX_GROUP_NAME_LENGTH;
        input.setAttribute('aria-label', 'Group name');
        input.addEventListener('input', () => renaming && (renaming.draft = input.value), {
          signal: abort.signal,
        });
        input.addEventListener(
          'keydown',
          event => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            finishRename(event.key === 'Enter');
          },
          { signal: abort.signal },
        );
        input.addEventListener('blur', () => renaming?.id === group.id && finishRename(true), {
          signal: abort.signal,
        });
        title = input;
        if (!typing) queueMicrotask(() => input.isConnected && (input.focus(), input.select()));
      } else {
        const name = owner.createElement('button');
        name.className = 'drawing-object-name';
        name.innerHTML = svg('folder', 16);
        const text = owner.createElement('span');
        text.textContent = group.name;
        const count = owner.createElement('span');
        count.className = 'drawing-group-count';
        count.textContent = String(members.length);
        // Member rows show the drawings while the group is open.
        name.append(text, ...(open ? [] : [count]));
        name.title = 'Double-click or press F2 to rename';
        name.setAttribute('aria-label', `Select group ${group.name}, ${members.length} drawings`);
        name.addEventListener('click', event => pick(group.drawings, event), { signal: abort.signal });
        name.addEventListener('dblclick', () => startRename(group), { signal: abort.signal });
        name.addEventListener(
          'keydown',
          event => {
            if (event.key !== 'F2') return;
            event.preventDefault();
            startRename(group);
          },
          { signal: abort.signal },
        );
        title = name;
      }
      row.append(
        fold,
        title,
        rowButton(
          allHidden ? 'eye-off' : 'eye',
          `${allHidden ? 'Show' : 'Hide'} group ${group.name}`,
          allHidden,
          () => run(members.map(d => ({ type: 'drawing.update', id: d.id, patch: { visible: allHidden } }))),
        ),
        rowButton(
          allLocked ? 'lock' : 'unlock',
          `${allLocked ? 'Unlock' : 'Lock'} group ${group.name}`,
          allLocked,
          () => run(members.map(d => ({ type: 'drawing.update', id: d.id, patch: { locked: !allLocked } }))),
        ),
        rowButton('ungroup', `Ungroup ${group.name}`, false, () =>
          chart.execute({ type: 'drawing.ungroup', id: group.id }),
        ),
        rowButton('trash', `Delete group ${group.name} and its drawings`, false, () =>
          run(members.map(d => ({ type: 'drawing.remove', id: d.id }))),
        ),
      );
      draggable(row, group.id);
      list.append(row);
      if (open) members.forEach(d => drawingRow(d, true));
    }
  }
  function interaction(value: DrawingInteractionState) {
    selection = value;
    const several = value.selection.length > 1;
    textEditor.selection(value.options.hidden ? null : (value.selected?.id ?? null));
    positionEditor.selection(value.options.hidden ? null : (value.selected?.id ?? null));
    editPositionButton.hidden = several || !isPosition(value.selected);
    editPositionButton.disabled = !!value.selected?.locked;
    editTextButton.hidden =
      several || !value.selected || !catalog.find(t => t.type === value.selected!.type)?.editableText;
    editTextButton.disabled = !!value.selected?.locked;
    strip.hidden = value.tool === 'cursor' && !value.selected;
    const definition = catalog.find(t => t.type === value.tool);
    if (definition && lastTool.get(definition.group) !== definition) {
      lastTool.set(definition.group, definition);
      showLast(definition.group);
    }
    strip.querySelector('.drawing-active-tool')!.textContent = several
      ? `${value.selection.length} drawings`
      : value.selected
        ? (catalog.find(t => t.type === value.selected!.type)?.label ?? value.selected.type)
        : (definition?.label ?? 'Cursor');
    strip
      .querySelector('.drawing-active-tool')!
      .setAttribute('title', definition?.hint ?? 'Select or move a drawing');
    buttons.forEach((button, group) => button.classList.toggle('active', definition?.group === group));
    favouriteBar?.setActive(value.tool);
    const cursor = rail.querySelector('#cursor')!;
    cursor.classList.toggle('active', value.tool === 'cursor');
    cursor.setAttribute('aria-pressed', String(value.tool === 'cursor'));
    const textOnly = several
      ? value.selection.every(d => ['text', 'price-label'].includes(d.type))
      : ['text', 'price-label'].includes(value.selected?.type ?? value.tool);
    strip.querySelector<CfSelectElement>('[aria-label="Drawing line width"]')!.hidden = textOnly;
    strip.querySelector<CfSelectElement>('[aria-label="Drawing line style"]')!.hidden = textOnly;
    const style = value.selected?.style ?? {
      ...value.options.style,
      ...value.options.toolDefaults[value.tool]?.style,
    };
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
    const locked = !!value.selection.length && value.selection.every(d => d.locked),
      noun = several ? 'drawings' : 'drawing';
    lockButton.innerHTML = svg(locked ? 'lock' : 'unlock', 18);
    lockButton.setAttribute('aria-pressed', String(locked));
    lockButton.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${noun}`);
    lockButton.dataset.tooltip = locked ? 'Unlock' : 'Lock';
    strip.querySelector('.drawing-delete-button')!.setAttribute('aria-label', `Delete ${noun}`);
    settingsButton.hidden = several;
    templateButtons[0].hidden = !templateTarget();
    if (strip.hidden || several) toggleSettings(false);
    if (!templateMenu.hidden) {
      // A name being typed keeps its form; the menu follows the selection.
      if (templateMode === 'menu') renderTemplates();
      positionTemplates();
    }
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
    const intervalChanged = state.feed.interval !== lastInterval;
    if (
      state.document.drawings !== lastDrawings ||
      state.document.drawingGroups !== lastGroups ||
      intervalChanged
    ) {
      lastDrawings = state.document.drawings;
      lastGroups = state.document.drawingGroups;
      lastInterval = state.feed.interval;
      renderObjects();
      if (intervalChanged && !settings.hidden) renderProperties();
    }
  }
  function reposition() {
    const button = buttons.get(openGroup);
    if (!flyout.hidden && button) positionTools(button);
    if (!objects.hidden) positionObjects();
    if (!settings.hidden) positionSettings();
    if (!templateMenu.hidden) positionTemplates();
  }
  const resize = new ResizeObserver(reposition);
  // Top-layer popups are fixed to the viewport, so they follow a scrolling host page.
  if (topLayer)
    owner.defaultView?.addEventListener('scroll', reposition, {
      capture: true,
      passive: true,
      signal: abort.signal,
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
      else if (catalog.find(t => t.type === drawing.type)?.editableText) editText(drawing);
      else {
        closeTools();
        toggleSettings(true);
      }
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
      templateMenu.remove();
      groupHolder.remove();
      redo.remove();
      unsubscribeFavourites?.();
      favouriteBar?.dispose();
      favouriteToggle.remove();
    },
  };
}
