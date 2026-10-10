import type { ChartApi } from './chart.ts';
import type { Drawing, DrawingStyle } from './drawing-types.ts';
import { uiIcon } from './ui-icons.ts';

/** Keeps typing local until Apply, so a text edit produces one undo entry. */
export function createDrawingTextEditor(
  chart: ChartApi,
  panel: HTMLElement,
  report: (message: string) => void,
) {
  const doc = panel.ownerDocument,
    tree = panel.getRootNode() as ShadowRoot | Document;
  const abort = new AbortController();
  const editor = doc.createElement('form');
  editor.className = 'drawing-text-editor';
  editor.hidden = true;
  editor.setAttribute('role', 'dialog');
  editor.setAttribute('aria-label', 'Edit annotation');
  editor.innerHTML = `<div class="drawing-panel-heading"><strong>Edit text</strong><button type="button" aria-label="Close text editor">${uiIcon('close', 18)}</button></div><label class="text-editor-label">Annotation<textarea aria-label="Annotation text" maxlength="2000" rows="4" placeholder="Type your annotation…"></textarea></label><div class="text-editor-options"><label>Size<input type="number" aria-label="Annotation font size" min="10" max="32" step="1"></label><label>Color<input type="color" aria-label="Annotation color"></label></div><p>Enter for a new line. ⌘/Ctrl + Enter to apply.</p><div class="text-editor-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="button primary">Apply text</button></div>`;
  panel.append(editor);
  const text = editor.querySelector('textarea')!,
    size = editor.querySelector<HTMLInputElement>('[type=number]')!,
    color = editor.querySelector<HTMLInputElement>('[type=color]')!;
  let session: { drawing: Drawing; generation: number; color: string; focus: HTMLElement | null } | null =
    null;
  const asHex = (value: string) =>
    value.length <= 5 ? `#${[...value.slice(1, 4)].map(c => c + c).join('')}` : value.slice(0, 7);
  function close(restoreFocus = true) {
    const previous = session;
    session = null;
    editor.hidden = true;
    if (restoreFocus && previous && editor.contains(tree.activeElement)) {
      const target = previous.focus?.isConnected
        ? previous.focus
        : panel.querySelector<HTMLElement>('.oc-chart');
      target?.focus({ preventScroll: true });
    }
  }
  function open(drawing: Drawing) {
    if (drawing.locked || !drawing.visible) return;
    if (session?.drawing.id === drawing.id) {
      text.focus({ preventScroll: true });
      return;
    }
    session = {
      drawing: structuredClone(drawing),
      generation: chart.inspect().generation,
      color: asHex(drawing.style.color),
      focus: tree.activeElement as HTMLElement | null,
    };
    editor.querySelector('strong')!.textContent =
      drawing.type === 'price-label'
        ? 'Edit price label'
        : drawing.type === 'callout'
          ? 'Edit callout'
          : 'Edit text';
    text.value = drawing.text;
    size.value = String(drawing.style.fontSize);
    color.value = session.color;
    editor.hidden = false;
    text.focus({ preventScroll: true });
    text.select();
  }
  editor.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (!session || !editor.reportValidity()) return;
      const original = session.drawing,
        state = chart.inspect();
      const current = chart.exportDocument().drawings.find(d => d.id === original.id);
      if (state.generation !== session.generation || !current || current.locked || !current.visible) {
        close();
        return;
      }
      // Never overwrite a concurrent host edit to the fields this editor owns.
      if (
        current.text !== original.text ||
        current.style.fontSize !== original.style.fontSize ||
        current.style.color !== original.style.color
      ) {
        report('This annotation changed while you were editing. Reopen it to edit the latest version.');
        close();
        return;
      }
      const style: Partial<DrawingStyle> = {};
      if (Number(size.value) !== original.style.fontSize) style.fontSize = Number(size.value);
      if (color.value !== session.color) style.color = color.value;
      try {
        if (text.value !== original.text || Object.keys(style).length)
          chart.execute(
            { type: 'drawing.update', id: original.id, patch: { text: text.value, style } },
            state.documentRevision,
          );
        close();
      } catch (error) {
        report(error instanceof Error ? error.message : String(error));
      }
    },
    { signal: abort.signal },
  );
  for (const button of editor.querySelectorAll<HTMLButtonElement>('[type=button]'))
    button.addEventListener('click', () => close(), { signal: abort.signal });
  editor.addEventListener(
    'keydown',
    event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        editor.requestSubmit();
      }
    },
    { signal: abort.signal },
  );
  const unsubscribe = chart.subscribe(state => {
    if (!session) return;
    const drawing = state.document.drawings.find(d => d.id === session!.drawing.id);
    if (state.generation !== session.generation || !drawing || drawing.locked || !drawing.visible) close();
  });
  return {
    open,
    selection(id: string | null) {
      if (session && session.drawing.id !== id) close(false);
    },
    dispose() {
      unsubscribe();
      abort.abort();
      session = null;
      editor.remove();
    },
  };
}
