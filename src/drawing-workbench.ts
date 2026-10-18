import { createPositionEditor } from './position-editor.ts';
import { isPosition, positionMetrics } from './position-drawing.ts';
import type { ChartApi } from './chart.ts';
import { activeChart } from './chart-switch.ts';
import type { RuntimeState } from './types.ts';
import type {
  Drawing,
  DrawingInteractionState,
  DrawingOptionValue,
  DrawingSetting,
  DrawingStyle,
  DrawingToolDefaults,
  DrawingToolDefinition,
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
import { DRAWING_HOTKEYS } from './drawing-tools.ts';
import { defineSelect, type CfSelectElement } from './select.ts';

const FAMILIES = ['Lines', 'Fib & Gann', 'Patterns', 'Forecasting', 'Shapes', 'Annotations'];
/** Line widths offered in the drawing toolbar, in pixels. */
const LINE_WIDTHS = [1, 2, 3, 5, 8];

export interface DrawingWorkbenchElements {
  root: HTMLElement;
  rail: HTMLElement;
  panel: HTMLElement;
  /** Named templates and saved tool defaults; the widget owns their storage. */
  templates: DrawingTemplates;
  report(message: string): void;
}

/** Instance-owned controls. The widget supplies layout, styles and the chart instance. */
export function createDrawingWorkbench(
  chart: ChartApi,
  { root, rail, panel, templates, report }: DrawingWorkbenchElements,
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
  const toolList = flyout.querySelector<HTMLElement>('.drawing-tool-list')!;
  let openGroup = groups[0],
    lastDrawings: readonly Drawing[] | undefined,
    lastHistory = '',
    selection: DrawingInteractionState = chart.drawingState();
  const buttons = new Map<string, HTMLButtonElement>(),
    moreButtons = new Map<string, HTMLButtonElement>();
  function closeTools() {
    flyout.hidden = true;
    buttons.forEach(b => b.setAttribute('aria-expanded', 'false'));
    moreButtons.forEach(b => b.setAttribute('aria-expanded', 'false'));
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
      lastTool.set(tool.group, tool);
      showLast(tool.group);
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
  /** Each family's rail button holds its last-used tool, like the familiar drawing rail. */
  const lastTool = new Map(groups.map(group => [group, catalog.find(t => t.group === group)!]));
  function openTools(group: string, b: HTMLElement) {
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
  settings.innerHTML = `<div class="drawing-panel-heading"><strong class="drawing-property-title">Defaults</strong><button class="drawing-close" aria-label="Close drawing settings">${svg('close', 16)}</button></div><div class="drawing-properties"><label>Text<textarea aria-label="Drawing text" maxlength="2000" rows="2"></textarea></label><div class="drawing-property-row"><label>Fill opacity<input aria-label="Drawing fill opacity" type="number" min="0" max="1" step="0.05"></label><label>Font size<input aria-label="Drawing font size" type="number" min="10" max="32" step="1"></label></div><div class="drawing-option-fields"></div><label class="drawing-levels-field">Levels<input aria-label="Fibonacci levels" placeholder="0, 0.236, 0.382, 0.5, 0.618, 1"></label><div class="drawing-anchor-fields"></div><div class="drawing-selected-actions"><button data-action="duplicate">Duplicate</button><button data-action="front">Bring to front</button><button data-action="back">Send to back</button></div><div class="drawing-template-footer"><button class="button drawing-template-open" aria-haspopup="dialog" aria-expanded="false" aria-controls="drawing-templates">Template${svg('chevron', 14)}</button></div></div>`;
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
    if (!open && templateTrigger === settings.querySelector('.drawing-template-open')) closeTemplates();
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
  /** The tool whose defaults an edit should update: the selection's, else the active tool. */
  const editedType = () => selection.selected?.type ?? (selection.tool === 'cursor' ? null : selection.tool);
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
    });
  }
  function editStyle(patch: Partial<DrawingStyle>) {
    attempt(() => {
      if (selection.selected)
        chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { style: patch } });
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
  const templateButtons = [
    strip.querySelector<HTMLButtonElement>('.drawing-template-button')!,
    settings.querySelector<HTMLButtonElement>('.drawing-template-open')!,
  ];
  let templateTrigger: HTMLButtonElement | null = null,
    templateMode: 'menu' | 'save' | 'replace' = 'menu',
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
    templateMenu.hidden = true;
    templateTrigger = null;
    templateMode = 'menu';
    templateDraft = templateError = '';
    templateButtons.forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function positionTemplates() {
    if (!templateTrigger) return;
    const bounds = panel.getBoundingClientRect(),
      anchor = templateTrigger.getBoundingClientRect();
    const bottom = bounds.bottom - anchor.top + 6;
    templateMenu.style.bottom = `${bottom}px`;
    templateMenu.style.maxHeight = `${Math.max(0, panel.clientHeight - bottom - 8)}px`;
    templateMenu.style.left = `${Math.max(8, Math.min(anchor.left - bounds.left, panel.clientWidth - templateMenu.offsetWidth - 8))}px`;
  }
  function openTemplates(trigger: HTMLButtonElement) {
    const wasOpen = !templateMenu.hidden && templateTrigger === trigger;
    closeTemplates();
    if (wasOpen) return;
    closeTools();
    templateTrigger = trigger;
    templateMenu.hidden = false;
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
    heading.textContent = `${target.tool.label} templates`;
    templateMenu.append(heading);
    if (templateMode !== 'menu') {
      const form = owner.createElement('form');
      form.className = 'drawing-template-form';
      if (templateMode === 'save') {
        const input = owner.createElement('input');
        input.value = templateDraft;
        input.maxLength = MAX_TEMPLATE_NAME_LENGTH;
        input.placeholder = 'Template name';
        input.setAttribute('aria-label', 'Template name');
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
        queueMicrotask(() => input.isConnected && input.focus({ preventScroll: true }));
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
      submit.textContent = templateMode === 'save' ? 'Save' : 'Replace';
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
          saveTemplate(templateMode === 'replace');
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
      const remove = owner.createElement('button');
      remove.className = 'drawing-template-delete';
      remove.innerHTML = svg('trash', 15);
      remove.setAttribute('aria-label', `Delete template ${name}`);
      remove.dataset.tooltip = 'Delete';
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
      row.append(apply, remove);
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
        const levels = (event.target as HTMLInputElement).value.trim()
          ? (event.target as HTMLInputElement).value.split(',').map(x => Number(x.trim()))
          : [];
        if (selection.selected)
          chart.execute({ type: 'drawing.update', id: selection.selected.id, patch: { levels } });
        remember({ levels });
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
  function renderOptions(fields: readonly DrawingSetting[], d: Drawing | null) {
    const holder = settings.querySelector<HTMLElement>('.drawing-option-fields')!;
    // Rebuilding while a field has focus would drop the user's place in the form.
    if (holder.contains(activeElement())) return;
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
        input.addEventListener('change', () => editOption(field.key, input.checked), {
          signal: abort.signal,
        });
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
    holder.hidden = !fields.length;
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
    settings.querySelector<HTMLElement>('.drawing-levels-field')!.hidden = !d?.type.startsWith('fib-');
    settings.querySelector<HTMLInputElement>('[aria-label="Fibonacci levels"]')!.value =
      d?.levels.join(', ') ?? '';
    renderOptions(tool?.settings ?? [], d);
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
    if (definition && lastTool.get(definition.group) !== definition) {
      lastTool.set(definition.group, definition);
      showLast(definition.group);
    }
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
    lockButton.innerHTML = svg(value.selected?.locked ? 'lock' : 'unlock', 18);
    lockButton.setAttribute('aria-pressed', String(!!value.selected?.locked));
    lockButton.setAttribute('aria-label', value.selected?.locked ? 'Unlock drawing' : 'Lock drawing');
    lockButton.dataset.tooltip = value.selected?.locked ? 'Unlock' : 'Lock';
    templateButtons[0].hidden = !templateTarget();
    if (strip.hidden) toggleSettings(false);
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
    if (!templateMenu.hidden) positionTemplates();
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
    },
  };
}
