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
.indicator-row{display:flex;align-items:center;gap:calc(8px * var(--space));min-height:calc(var(--control-height) + 6px);padding:0 calc(8px * var(--space)) 0 calc(16px * var(--space))}
.indicator-row:hover{background:var(--hover)}
.indicator-row strong{color:var(--bright);font-weight:var(--ui-weight);white-space:nowrap}
.indicator-row.hidden strong{color:var(--muted)}
.indicator-inputs{display:flex;flex-wrap:wrap;gap:calc(6px * var(--space));margin-right:auto}
.indicator-inputs label{display:flex;align-items:center;gap:calc(4px * var(--space));color:var(--muted);font-size:var(--small-size)}
.indicator-inputs input{width:5em;height:calc(var(--control-height) - 6px);padding:0 calc(6px * var(--space));border:var(--border-width) solid var(--line);border-radius:var(--radius);background:var(--bg);color:var(--bright);font:var(--ui-weight) var(--small-size) var(--mono)}
.indicator-row .indicator-note{margin-right:auto;color:var(--muted);font-size:var(--small-size)}
.indicator-row button.indicator-icon{display:grid;place-items:center;flex-shrink:0;width:calc(var(--control-height) - 4px);height:calc(var(--control-height) - 4px);border-radius:var(--radius);color:var(--muted)}
.indicator-row button.indicator-icon:hover{background:none;color:var(--bright)}
.indicator-row.hidden .indicator-icon[data-toggle]{color:var(--accent)}
.indicator-add{display:flex;align-items:center;gap:calc(12px * var(--space));width:100%;min-height:calc(var(--control-height) + 4px);padding:0 calc(16px * var(--space));text-align:left;color:var(--text)}
.indicator-add:hover,.indicator-add:focus-visible{background:var(--hover);color:var(--bright)}
.indicator-add span{white-space:nowrap}
.indicator-add small{margin-left:auto;color:var(--muted);font-size:var(--small-size);white-space:nowrap}
.indicator-empty{margin:0;padding:calc(20px * var(--space)) calc(16px * var(--space));color:var(--muted);text-align:center}
#indicator-menu .add-mark{font-size:calc(var(--ui-size) + 5px);font-weight:var(--ui-weight);line-height:1}
`;

const paneNames = { price: 'Overlay', separate: 'Pane', profile: 'Price axis' } as const;

/**
 * A search box over every registered kind, with the active indicators first.
 * Every change is a chart command, so it is undoable and saved with the layout.
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
  const run = (action: () => void) => {
    try {
      action();
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
    render();
  };
  const iconButton = (icon: string, label: string, action: () => void) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'indicator-icon';
    button.innerHTML = svg(icon, 16);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => run(action));
    return button;
  };
  const heading = (text: string) => {
    const h = doc.createElement('h3');
    h.textContent = text;
    return h;
  };
  function render() {
    const state = chart.inspect();
    const kinds = new Map(state.indicatorKinds.map(kind => [kind.kind, kind]));
    const terms = query.value.toLowerCase().trim();
    const sections: HTMLElement[] = [];
    if (state.indicators.length && !terms) {
      const list = doc.createElement('ul');
      list.className = 'indicator-list';
      for (const indicator of state.indicators) {
        const row = doc.createElement('li');
        row.className = `indicator-row${indicator.visible ? '' : ' hidden'}`;
        const name = doc.createElement('strong');
        name.textContent = indicator.name;
        row.append(name);
        const spec = kinds.get(indicator.kind);
        if (!indicator.supported) {
          const note = doc.createElement('span');
          note.className = 'indicator-note';
          note.textContent = 'Unavailable here';
          row.append(note);
        } else {
          const inputs = doc.createElement('span');
          inputs.className = 'indicator-inputs';
          for (const [key, input] of Object.entries(spec?.inputs ?? {})) {
            const label = doc.createElement('label');
            const field = doc.createElement('input');
            field.type = 'number';
            field.min = String(input.min);
            field.max = String(input.max);
            field.step = input.integer === false ? 'any' : '1';
            field.value = String(indicator.inputs[key] ?? input.default);
            field.setAttribute('aria-label', `${indicator.name} ${input.label}`);
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
        const toggle = iconButton(
          indicator.visible ? 'eye' : 'eye-off',
          `${indicator.visible ? 'Hide' : 'Show'} ${indicator.name}`,
          () => chart.execute({ type: 'indicator.update', id: indicator.id, visible: !indicator.visible }),
        );
        toggle.dataset.toggle = '';
        row.append(
          toggle,
          iconButton('close', `Remove ${indicator.name}`, () =>
            chart.execute({ type: 'indicator.remove', id: indicator.id }),
          ),
        );
        list.append(row);
      }
      sections.push(heading('On chart'), list);
    }
    const matches = state.indicatorKinds.filter(
      kind => !terms || `${kind.name} ${kind.kind} ${kind.description}`.toLowerCase().includes(terms),
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
        button.addEventListener('click', () =>
          run(() => {
            chart.execute({ type: 'indicator.add', indicator: { kind: kind.kind } });
            report(`Added ${kind.name}.`);
          }),
        );
        list.append(button);
      }
      sections.push(heading(terms ? 'Results' : 'Indicators'), list);
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
