import type { ChartApi } from './chart.ts';

/** Scoped styles for the indicator dialog inside the widget shadow root. */
export const indicatorPanelStyles: string = `
.indicator-panel{display:grid;gap:calc(14px * var(--space));font-size:var(--ui-size)}
.indicator-panel h3{font:var(--heading-weight) calc(var(--ui-size) + 1px) var(--serif);color:var(--bright);margin:0}
.indicator-panel .indicator-empty{color:var(--muted);margin:0}
.indicator-list{display:grid;gap:calc(8px * var(--space));margin:0;padding:0;list-style:none}
.indicator-row{display:grid;gap:calc(6px * var(--space));padding:calc(8px * var(--space));border:var(--border-width) solid var(--line);border-radius:var(--radius)}
.indicator-row header{display:flex;align-items:center;gap:calc(8px * var(--space))}
.indicator-row header strong{color:var(--bright);font-weight:clamp(100,calc(var(--ui-weight) + 100),900)}
.indicator-row header small{color:var(--muted)}
.indicator-row header .indicator-actions{margin-left:auto;display:flex;gap:calc(4px * var(--space))}
.indicator-row button,.indicator-add button{padding:calc(4px * var(--space)) calc(8px * var(--space));border-radius:var(--radius);border:var(--border-width) solid var(--line);color:var(--text)}
.indicator-row button:hover,.indicator-add button:hover{background:var(--hover)}
.indicator-inputs{display:flex;flex-wrap:wrap;gap:calc(8px * var(--space))}
.indicator-inputs label{display:grid;gap:2px;color:var(--muted);font-size:var(--small-size)}
.indicator-inputs input{width:6.5em;padding:calc(4px * var(--space));border:var(--border-width) solid var(--line-strong);border-radius:var(--radius);background:var(--surface);color:var(--text);font:var(--ui-weight) var(--ui-size) var(--mono)}
.indicator-add{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:calc(6px * var(--space))}
.indicator-add button{display:grid;text-align:left;gap:2px}
#indicator-menu .add-mark{font-size:calc(var(--ui-size) + 5px);font-weight:var(--ui-weight);line-height:1}
.indicator-add button small{color:var(--muted);font-size:var(--small-size);line-height:1.35}
`;

/**
 * Lists active indicators with editable inputs, and every registered kind to add.
 * Every change is a chart command, so it is undoable and saved with the layout.
 */
export function createIndicatorPanel(
  chart: ChartApi,
  doc: Document,
  report: (message: string) => void,
): { element: HTMLElement; render(): void } {
  const element = doc.createElement('div');
  element.className = 'indicator-panel';
  const run = (action: () => void) => {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
    render();
  };
  function render() {
    const state = chart.inspect();
    const kinds = new Map(state.indicatorKinds.map(kind => [kind.kind, kind]));
    const active = doc.createElement('section');
    const heading = doc.createElement('h3');
    heading.textContent = 'On this chart';
    active.append(heading);
    if (!state.indicators.length) {
      const empty = doc.createElement('p');
      empty.className = 'indicator-empty';
      empty.textContent = 'No indicators yet. Add one below.';
      active.append(empty);
    }
    const list = doc.createElement('ul');
    list.className = 'indicator-list';
    for (const indicator of state.indicators) {
      const row = doc.createElement('li');
      row.className = 'indicator-row';
      const header = doc.createElement('header');
      const name = doc.createElement('strong');
      name.textContent = indicator.name;
      const note = doc.createElement('small');
      note.textContent = indicator.supported
        ? indicator.pane === 'separate'
          ? 'Own pane'
          : indicator.pane === 'profile'
            ? 'Price axis'
            : 'On price'
        : 'Unavailable here';
      const actions = doc.createElement('span');
      actions.className = 'indicator-actions';
      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.textContent = indicator.visible ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', `${indicator.visible ? 'Hide' : 'Show'} ${indicator.name}`);
      toggle.addEventListener('click', () =>
        run(() => chart.execute({ type: 'indicator.update', id: indicator.id, visible: !indicator.visible })),
      );
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${indicator.name}`);
      remove.addEventListener('click', () =>
        run(() => chart.execute({ type: 'indicator.remove', id: indicator.id })),
      );
      actions.append(toggle, remove);
      header.append(name, note, actions);
      row.append(header);
      const spec = kinds.get(indicator.kind);
      if (spec && Object.keys(spec.inputs).length) {
        const inputs = doc.createElement('div');
        inputs.className = 'indicator-inputs';
        for (const [key, input] of Object.entries(spec.inputs)) {
          const label = doc.createElement('label');
          const field = doc.createElement('input');
          field.type = 'number';
          field.min = String(input.min);
          field.max = String(input.max);
          field.step = input.integer === false ? 'any' : '1';
          field.value = String(indicator.inputs[key] ?? input.default);
          field.addEventListener('change', () => {
            const value = Number(field.value);
            run(() =>
              chart.execute({ type: 'indicator.update', id: indicator.id, inputs: { [key]: value } }),
            );
          });
          label.append(input.label, field);
          inputs.append(label);
        }
        row.append(inputs);
      }
      list.append(row);
    }
    active.append(list);
    const add = doc.createElement('section');
    const addHeading = doc.createElement('h3');
    addHeading.textContent = 'Add';
    const grid = doc.createElement('div');
    grid.className = 'indicator-add';
    for (const kind of state.indicatorKinds) {
      const button = doc.createElement('button');
      button.type = 'button';
      const title = doc.createElement('span');
      title.textContent = kind.name;
      const description = doc.createElement('small');
      description.textContent = kind.description;
      button.append(title, description);
      button.addEventListener('click', () =>
        run(() => chart.execute({ type: 'indicator.add', indicator: { kind: kind.kind } })),
      );
      grid.append(button);
    }
    add.append(addHeading, grid);
    element.replaceChildren(active, add);
  }
  render();
  return { element, render };
}
