import type { DrawingVisibility, DrawingVisibilityRange, DrawingVisibilityUnit } from './drawing-types.ts';
import { DRAWING_VISIBILITY_UNITS, visibilityRange } from './drawing-visibility.ts';

/**
 * Fills `holder` with the Visibility section: a checkbox and a from/to count per interval
 * family. `onChange` receives one family's whole range, already clamped and in order.
 */
export function renderVisibilityFields(
  holder: HTMLElement,
  visibility: DrawingVisibility | undefined,
  onChange: (unit: DrawingVisibilityUnit, range: DrawingVisibilityRange) => void,
  { note, signal }: { note?: string; signal: AbortSignal },
): void {
  const owner = holder.ownerDocument,
    tree = holder.getRootNode() as ShadowRoot | Document;
  // Rebuilding while a field has focus would drop the user's place in the form.
  if (holder.contains(tree.activeElement)) return;
  holder.replaceChildren();
  const section = owner.createElement('fieldset');
  section.className = 'drawing-option-section drawing-visibility';
  const legend = owner.createElement('legend');
  legend.textContent = 'Visibility';
  section.append(legend);
  if (note) {
    const p = owner.createElement('p');
    p.className = 'drawing-visibility-note';
    p.textContent = note;
    section.append(p);
  }
  for (const { unit, label, min, max } of DRAWING_VISIBILITY_UNITS) {
    const range = visibilityRange(visibility, unit);
    const row = owner.createElement('div');
    row.className = 'drawing-visibility-row';
    const toggle = owner.createElement('label');
    toggle.className = 'drawing-option drawing-option-boolean';
    const enabled = owner.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = range.enabled;
    const name = owner.createElement('span');
    name.textContent = label;
    toggle.append(enabled, name);
    const count = (value: number, which: string) => {
      const input = owner.createElement('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(value);
      input.disabled = !range.enabled;
      input.setAttribute('aria-label', `${label} ${which}`);
      return input;
    };
    const from = count(range.from, 'from'),
      to = count(range.to, 'to');
    const dash = owner.createElement('span');
    dash.className = 'drawing-visibility-dash';
    dash.setAttribute('aria-hidden', 'true');
    dash.textContent = '–';
    const read = (input: HTMLInputElement, fallback: number) => {
      const n = Math.round(Number(input.value));
      return Number.isFinite(n) && input.value.trim() ? Math.max(min, Math.min(max, n)) : fallback;
    };
    // The edited end wins when the two cross, like dragging one thumb of a range slider.
    const commit = (edited?: 'from' | 'to') => {
      let low = read(from, range.from),
        high = read(to, range.to);
      if (low > high) [low, high] = edited === 'to' ? [high, high] : [low, low];
      from.value = String(low);
      to.value = String(high);
      from.disabled = to.disabled = !enabled.checked;
      onChange(unit, { enabled: enabled.checked, from: low, to: high });
    };
    enabled.addEventListener('change', () => commit(), { signal });
    from.addEventListener('change', () => commit('from'), { signal });
    to.addEventListener('change', () => commit('to'), { signal });
    row.append(toggle, from, dash, to);
    section.append(row);
  }
  holder.append(section);
}

export const drawingVisibilityStyles: string = `
.drawing-visibility-fields{display:grid}.drawing-visibility-fields:empty{display:none}.drawing-option-section.drawing-visibility{grid-template-columns:max-content minmax(0,1fr) auto minmax(0,1fr);align-items:center}.drawing-visibility input[type=number]{min-width:0}.drawing-visibility-row{display:contents}.drawing-visibility-dash{color:var(--faint)}.drawing-visibility input[type=number]:disabled{opacity:.45}.drawing-visibility-note{grid-column:1/-1;margin:0;color:var(--muted);font-size:var(--small-size)}
.drawing-object-name .drawing-object-label{min-width:0;overflow:hidden;text-overflow:ellipsis}.drawing-object-text{display:grid;min-width:0;line-height:1.2}.drawing-object-hint{overflow:hidden;text-overflow:ellipsis;color:var(--faint);font-size:calc(var(--small-size) - 1px)}.drawing-object-row.off-interval .drawing-object-name{color:var(--muted)}
`;
