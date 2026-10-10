import type { ChartApi } from './chart.ts';
import type { Drawing } from './drawing-types.ts';
import { isPosition, positionDirection, positionMetrics } from './position-drawing.ts';
import { uiIcon } from './ui-icons.ts';

/** Local drafts keep a multi-field position edit in one undo entry. */
export function createPositionEditor(chart: ChartApi, panel: HTMLElement) {
  const doc = panel.ownerDocument, tree = panel.getRootNode() as ShadowRoot | Document, abort = new AbortController();
  const element = doc.createElement('form'); element.className = 'position-editor'; element.hidden = true;
  element.setAttribute('role', 'dialog'); element.setAttribute('aria-label', 'Position settings'); element.setAttribute('part', 'position-editor');
  element.innerHTML = `<div class="drawing-panel-heading"><strong>Position</strong><button type="button" aria-label="Close position settings">${uiIcon('close', 18)}</button></div>
    <div class="position-summary"><span>Reward / risk</span><output class="position-ratio">1.00<span>R</span></output></div>
    <div class="position-fields"><label>Entry<input name="entry" aria-label="Position entry price" type="number" required></label>
    <label class="position-target">Target<span class="position-percent" data-target-percent></span><input name="target" aria-label="Position target price" type="number" required></label>
    <label class="position-stop">Stop<span class="position-percent" data-stop-percent></span><input name="stop" aria-label="Position stop price" type="number" required></label></div>
    <div class="position-ratio-controls"><label>Reward / risk<input name="ratio" aria-label="Position reward / risk" type="number" min="0.01" step="any"></label><div class="position-presets" aria-label="Reward to risk presets"><button type="button" data-ratio="1">1R</button><button type="button" data-ratio="2">2R</button><button type="button" data-ratio="3">3R</button></div></div>
    <label class="position-width">Width in bars<input name="bars" aria-label="Position width in bars" type="number" min="1" max="100000" step="any" required></label>
    <p class="position-error" role="alert" hidden></p><p class="position-guidance">Drag the shaded area to move. Use the level handles to adjust prices and the side handle to resize.</p>
    <div class="text-editor-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="button primary">Apply position</button></div>`;
  panel.append(element);
  const field = (name: string) => element.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  const error = element.querySelector<HTMLElement>('.position-error')!;
  let session: { drawing: Drawing; generation: number; interval: number; tick: number; initial: Record<string, string>; focus: HTMLElement | null } | null = null;
  function close(restoreFocus = true) {
    const previous = session; session = null; element.hidden = true;
    if (restoreFocus && previous && element.contains(tree.activeElement)) (previous.focus?.isConnected ? previous.focus : panel.querySelector<HTMLElement>('.oc-chart'))?.focus({ preventScroll: true });
  }
  function draft(): Drawing {
    const current = session!;
    const points = current.drawing.points.map(point => ({ ...point }));
    for (const [index, name] of ['entry', 'target', 'stop'].entries()) if (field(name).value !== current.initial[name]) points[index].price = field(name).value.trim() ? Number(field(name).value) : NaN;
    const bars = Number(field('bars').value), sign = Math.sign(points[1].timeMs - points[0].timeMs) || 1;
    if (field('bars').value !== current.initial.bars) { points[1].timeMs = points[0].timeMs + sign * bars * current.interval; points[2].timeMs = points[1].timeMs; }
    return { ...current.drawing, points };
  }
  function refreshMetrics() {
    if (!session) return;
    const metrics = positionMetrics(draft()), valid = metrics.risk > 0 && metrics.reward > 0 && Number.isFinite(metrics.ratio);
    element.querySelector('output')!.textContent = valid ? `${metrics.ratio.toFixed(2)}R` : '—';
    element.querySelector('[data-target-percent]')!.textContent = valid ? `+${metrics.rewardPercent.toFixed(2)}%` : '';
    element.querySelector('[data-stop-percent]')!.textContent = valid ? `−${metrics.riskPercent.toFixed(2)}%` : '';
    field('ratio').value = valid ? String(Number(metrics.ratio.toFixed(4))) : '';
    for (const button of element.querySelectorAll<HTMLButtonElement>('[data-ratio]')) button.setAttribute('aria-pressed', String(valid && Math.abs(metrics.ratio - Number(button.dataset.ratio)) < 0.005));
  }
  function setRatio(ratio: number) {
    if (!session || !Number.isFinite(ratio) || ratio <= 0) return;
    const entry = Number(field('entry').value), stop = Number(field('stop').value), direction = positionDirection(session.drawing.type), risk = (entry - stop) * direction;
    if (!Number.isFinite(risk) || risk <= 0) return;
    const target = entry + direction * risk * ratio;
    field('target').value = String(Number(target.toFixed(chart.inspect().feed.instrument.pricePrecision)));
    refreshMetrics();
  }
  function open(drawing: Drawing) {
    if (!isPosition(drawing) || drawing.locked || !drawing.visible) return;
    if (session?.drawing.id === drawing.id) { field('entry').focus({ preventScroll: true }); return; }
    const state = chart.inspect();
    session = { drawing: structuredClone(drawing), generation: state.generation, interval: state.feed.intervalMs, tick: state.feed.instrument.tickSize, initial: {}, focus: tree.activeElement as HTMLElement | null };
    element.querySelector('strong')!.textContent = drawing.type === 'long-position' ? 'Long position' : 'Short position';
    for (const [i, name] of ['entry', 'target', 'stop'].entries()) { field(name).value = String(Number(drawing.points[i].price.toFixed(state.feed.instrument.pricePrecision))); field(name).min = String(session.tick); field(name).step = 'any'; }
    field('bars').value = String(Number((Math.abs(drawing.points[1].timeMs - drawing.points[0].timeMs) / session.interval).toFixed(4)));
    session.initial = Object.fromEntries(['entry', 'target', 'stop', 'bars'].map(name => [name, field(name).value]));
    error.hidden = true; refreshMetrics(); element.hidden = false; field('entry').focus({ preventScroll: true }); field('entry').select();
  }
  for (const name of ['entry', 'target', 'stop']) field(name).addEventListener('input', refreshMetrics, { signal: abort.signal });
  field('ratio').addEventListener('change', () => setRatio(Number(field('ratio').value)), { signal: abort.signal });
  for (const button of element.querySelectorAll<HTMLButtonElement>('[data-ratio]')) button.addEventListener('click', () => setRatio(Number(button.dataset.ratio)), { signal: abort.signal });
  for (const button of element.querySelectorAll<HTMLButtonElement>('[data-cancel], [aria-label="Close position settings"]')) button.addEventListener('click', () => close(), { signal: abort.signal });
  element.addEventListener('keydown', event => {
    event.stopPropagation(); if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); element.requestSubmit(); }
  }, { signal: abort.signal });
  element.addEventListener('submit', event => {
    event.preventDefault(); if (!session || !element.reportValidity()) return;
    const state = chart.inspect(), current = chart.exportDocument().drawings.find(drawing => drawing.id === session!.drawing.id);
    if (state.generation !== session.generation || !current || current.locked || !current.visible) { close(); return; }
    try {
      if (JSON.stringify(current.points) !== JSON.stringify(session.drawing.points)) throw new Error('This position changed while you were editing. Close and reopen its settings.');
      const next = draft(), metrics = positionMetrics(next);
      if (!(metrics.reward > 0 && metrics.risk > 0)) throw new Error(next.type === 'long-position' ? 'Place the target above entry and the stop below entry.' : 'Place the target below entry and the stop above entry.');
      if (JSON.stringify(next.points) !== JSON.stringify(current.points)) chart.execute({ type: 'drawing.update', id: current.id, patch: { points: next.points } }, state.documentRevision);
      close();
    } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; }
  }, { signal: abort.signal });
  const unsubscribe = chart.subscribe(state => { if (session) { const drawing = state.document.drawings.find(d => d.id === session!.drawing.id); if (state.generation !== session.generation || !drawing || drawing.locked || !drawing.visible) close(); } });
  return { open, close, selection(id: string | null) { if (session && session.drawing.id !== id) close(false); }, dispose() { unsubscribe(); abort.abort(); session = null; element.remove(); } };
}
