import type { ChartApi } from './chart.ts';
import { uiIcon as svg } from './ui-icons.ts';

/** Scoped styles for the indicator dialog inside the widget shadow root. */
export const indicatorPanelStyles: string = `
.widget-dialog.indicator-dialog{inset:calc(var(--toolbar-height) + 40px * var(--space)) auto auto 50%;transform:translateX(-50%);width:min(calc(var(--ui-size) * 40),calc(100% - 20px));height:min(calc(var(--ui-size) * 46),calc(100% - var(--toolbar-height) - var(--footer-height) - 60px * var(--space)))}
.indicator-dialog .dialog-content{display:flex;flex-direction:column;flex:1;min-height:0;padding:0;line-height:normal}
.indicator-panel{display:flex;flex-direction:column;flex:1;min-height:0;font-size:var(--ui-size)}
.indicator-search{position:relative;flex-shrink:0;padding:calc(10px * var(--space)) calc(12px * var(--space));border-bottom:var(--border-width) solid var(--line)}
.indicator-search svg{position:absolute;left:calc(22px * var(--space));top:50%;transform:translateY(-50%);color:var(--muted)}
.indicator-search input{width:100%;height:var(--control-height);padding:0 calc(10px * var(--space)) 0 calc(34px * var(--space));border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--bg);color:var(--bright);font-size:var(--ui-size)}
.indicator-search input::placeholder{color:var(--muted)}
.indicator-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-bottom:calc(6px * var(--space))}
.indicator-panel h3{margin:0;padding:calc(12px * var(--space)) calc(16px * var(--space)) calc(4px * var(--space));color:var(--muted);font-size:var(--small-size);font-weight:var(--ui-weight);letter-spacing:.5px;text-transform:uppercase}
.indicator-list{margin:0;padding:0;list-style:none}
.indicator-add{display:flex;align-items:center;gap:calc(12px * var(--space));width:100%;min-height:calc(var(--control-height) + 4px);padding:0 calc(16px * var(--space));text-align:left;color:var(--text)}
.indicator-add:hover,.indicator-add:focus-visible{background:var(--hover);color:var(--bright)}
.indicator-add span{white-space:nowrap}
.indicator-add small{margin-left:auto;color:var(--muted);font-size:var(--small-size);white-space:nowrap}
.indicator-empty{margin:0;padding:calc(20px * var(--space)) calc(16px * var(--space));color:var(--muted);text-align:center}
.widget-dialog.settings-dialog{inset:50% auto auto 50%;transform:translate(-50%,-50%);width:min(var(--theme-layout-dialogWidth,364px),calc(100% - 20px))}
.indicator-settings{display:grid;gap:calc(10px * var(--space))}
.indicator-settings label{display:grid;grid-template-columns:1fr minmax(7em,auto);align-items:center;gap:calc(10px * var(--space));color:var(--text)}
.indicator-settings select{height:var(--control-height);padding:0 calc(8px * var(--space));border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--bg);color:var(--bright);font:var(--ui-weight) var(--ui-size) var(--ui-font,inherit)}
.indicator-settings input{height:var(--control-height);padding:0 calc(8px * var(--space));border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--bg);color:var(--bright);font:var(--ui-weight) var(--ui-size) var(--mono)}
.indicator-settings input[type=checkbox]{justify-self:end;width:16px;height:16px;margin:0;accent-color:var(--accent)}
.indicator-settings p{margin:0;color:var(--muted)}
.legend-indicator>.legend-item{position:relative;gap:calc(6px * var(--space));min-height:calc(var(--control-height) - 6px);padding:0 calc(4px * var(--space));margin-left:calc(-4px * var(--space));border-radius:var(--radius);pointer-events:auto}
.legend-item:hover,.legend-item:focus-within{background:var(--surface);text-shadow:none}
.legend-item .legend-name{color:var(--text)}
.legend-item.off .legend-name{opacity:.5}
.legend-item.off i{opacity:.35}
.legend-actions{display:none;align-items:center}
.legend-item:hover .legend-actions,.legend-item:focus-within .legend-actions{display:inline-flex}
@media (hover:none){.legend-actions{display:inline-flex}}
.legend-actions button{display:grid;place-items:center;width:calc(var(--control-height) - 8px);height:calc(var(--control-height) - 8px);border-radius:var(--radius);color:var(--muted)}
.legend-actions button:hover,.legend-actions button:focus-visible{background:var(--hover);color:var(--bright)}
`;

const paneNames = { price: 'Overlay', separate: 'Pane', profile: 'Price axis' } as const;

/**
 * A search box over every registered kind; clicking one adds it. Indicators on the chart
 * are managed from the chart legend instead. Every change is a chart command, so it is
 * undoable and saved with the layout.
 */
export function createIndicatorPanel(
  chart: ChartApi,
  doc: Document,
  report: (message: string) => void,
): { element: HTMLElement; render(): void } {
  const element = doc.createElement('div');
  element.className = 'indicator-panel';
  const search = doc.createElement('label');
  search.className = 'indicator-search';
  search.innerHTML = `${svg('search', 16)}<input type="search" placeholder="Search" aria-label="Search indicators" autocomplete="off" data-autofocus>`;
  const query = search.querySelector('input')!;
  const scroll = doc.createElement('div');
  scroll.className = 'indicator-scroll';
  element.append(search, scroll);
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
  };
  const heading = (text: string) => {
    const h = doc.createElement('h3');
    h.textContent = text;
    return h;
  };
  function render() {
    const state = chart.inspect();
    const terms = query.value.toLowerCase().trim();
    const sections: HTMLElement[] = [];
    const matches = state.indicatorKinds.filter(
      kind =>
        !kind.hidden &&
        (!terms || `${kind.name} ${kind.kind} ${kind.description}`.toLowerCase().includes(terms)),
    );
    if (matches.length) {
      const list = doc.createElement('div');
      for (const kind of matches) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'indicator-add';
        button.title = kind.description;
        const title = doc.createElement('span');
        title.textContent = kind.name;
        const pane = doc.createElement('small');
        pane.textContent = paneNames[kind.pane];
        button.append(title, pane);
        // No re-render: the list does not change, and replacing it would drop keyboard focus.
        button.addEventListener('click', () =>
          attempt(() => {
            chart.execute({ type: 'indicator.add', indicator: { kind: kind.kind } });
            // The toolbar has no layer switch, so a hidden layer would swallow the new one.
            if (!chart.inspect().document.layers.indicator)
              chart.execute({ type: 'layer.set', layer: 'indicator', visible: true });
            report(`Added ${kind.name}.`);
          }),
        );
        list.append(button);
      }
      sections.push(heading(terms ? 'Results' : 'All indicators'), list);
    } else {
      const empty = doc.createElement('p');
      empty.className = 'indicator-empty';
      empty.textContent = 'No matching indicators';
      sections.push(empty);
    }
    const top = scroll.scrollTop;
    scroll.replaceChildren(...sections);
    scroll.scrollTop = top;
  }
  query.addEventListener('input', () => {
    scroll.scrollTop = 0;
    render();
  });
  render();
  return { element, render };
}

/** Number inputs for one indicator; each change applies at once. */
export function createIndicatorSettings(
  chart: ChartApi,
  doc: Document,
  id: string,
  report: (message: string) => void,
): HTMLElement {
  const state = chart.inspect();
  const indicator = state.indicators.find(i => i.id === id);
  const spec = state.indicatorKinds.find(kind => kind.kind === indicator?.kind);
  const element = doc.createElement('div');
  element.className = 'indicator-settings';
  const inputs = Object.entries(spec?.inputs ?? {});
  if (!indicator || !spec || !inputs.length) {
    const note = doc.createElement('p');
    note.textContent = !indicator
      ? 'This indicator was removed.'
      : spec
        ? 'This indicator has no settings.'
        : 'This indicator is unavailable here.';
    element.append(note);
    return element;
  }
  inputs.forEach(([key, input], k) => {
    const label = doc.createElement('label');
    const current = () => chart.inspect().indicators.find(i => i.id === id)?.inputs[key] ?? input.default;
    if (input.options) {
      const select = doc.createElement('select');
      input.options.forEach((name, value) => select.append(new Option(name, String(value))));
      select.value = String(indicator.inputs[key] ?? input.default);
      if (!k) select.dataset.autofocus = '';
      select.addEventListener('change', () => {
        try {
          chart.execute({ type: 'indicator.update', id, inputs: { [key]: Number(select.value) } });
        } catch (error) {
          report(error instanceof Error ? error.message : String(error));
          select.value = String(current());
        }
      });
      label.append(input.label, select);
      element.append(label);
      return;
    }
    const field = doc.createElement('input');
    if (input.toggle) {
      label.className = 'toggle';
      field.type = 'checkbox';
      field.checked = !!(indicator.inputs[key] ?? input.default);
    } else {
      field.type = 'number';
      field.min = String(input.min);
      field.max = String(input.max);
      field.step = input.integer === false ? 'any' : '1';
      field.value = String(indicator.inputs[key] ?? input.default);
    }
    if (!k) field.dataset.autofocus = '';
    field.addEventListener('change', () => {
      try {
        const value = input.toggle ? +field.checked : Number(field.value);
        chart.execute({ type: 'indicator.update', id, inputs: { [key]: value } });
      } catch (error) {
        report(error instanceof Error ? error.message : String(error));
        if (input.toggle) field.checked = !!current();
        else field.value = String(current());
      }
    });
    label.append(input.label, field);
    element.append(label);
  });
  return element;
}

/** What the chart legend needs from each indicator on the chart. */
export interface LegendIndicator {
  id: string;
  name: string;
  color: string;
  /** Drawn: the indicator and the indicator layer are both on. */
  shown: boolean;
}

/** Legend rows with hide, settings and remove buttons, shown on hover or focus. */
export function renderIndicatorLegend(
  host: HTMLElement,
  doc: Document,
  items: readonly LegendIndicator[],
  actions: { toggle(id: string): void; settings(id: string): void; remove(id: string): void },
): void {
  const button = (icon: string, label: string, action: () => void) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.innerHTML = svg(icon, 14);
    element.setAttribute('aria-label', label);
    element.title = label;
    element.addEventListener('click', action);
    return element;
  };
  host.replaceChildren(
    ...items.map(item => {
      const row = doc.createElement('span');
      row.className = `legend-item${item.shown ? '' : ' off'}`;
      const swatch = doc.createElement('i');
      swatch.style.background = item.color;
      const name = doc.createElement('span');
      name.className = 'legend-name';
      name.textContent = item.name;
      row.append(swatch, name);
      const tools = doc.createElement('span');
      tools.className = 'legend-actions';
      tools.append(
        button(item.shown ? 'eye' : 'eye-off', `${item.shown ? 'Hide' : 'Show'} ${item.name}`, () =>
          actions.toggle(item.id),
        ),
        button('settings', `${item.name} settings`, () => actions.settings(item.id)),
        button('close', `Remove ${item.name}`, () => actions.remove(item.id)),
      );
      row.append(tools);
      return row;
    }),
  );
}
