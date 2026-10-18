import { ChartError, toChartError } from './errors.ts';
import { DEFAULT_DRAWING_STYLE, DrawingRegistry, translateDrawing } from './drawing-tools.ts';
import { plotOptions, plotPoint } from './drawing-primitives.ts';
import { drawingHandles, hitDrawings } from './drawing-scene.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingInteractionState,
  DrawingModifiers,
  DrawingOptions,
  DrawingOptionsPatch,
  DrawingPoint,
} from './drawing-types.ts';
import type { Anchor, ChartCommand, RuntimeState } from './types.ts';

interface ControllerHost {
  registry: DrawingRegistry;
  state(): RuntimeState;
  execute(command: ChartCommand, revision?: number): void;
  changed(state: DrawingInteractionState): void;
  error(error: Error): void;
}
interface Gesture {
  mode: 'body' | 'handle' | 'freehand';
  original: Drawing;
  start: Anchor;
  pointer: DrawingPoint;
  handle: number | string | null;
  cursor?: string;
  revision: number;
  moved?: boolean;
  /** Commit as a new drawing and leave the original in place. */
  clone?: boolean;
}

/** Owns unfinished drawing gestures. Only completed edits reach the runtime. */
export class DrawingController {
  private host: ControllerHost;
  private tool = 'cursor';
  private selectedId: string | null = null;
  private draft: Drawing | null = null;
  private fixed: Anchor[] = [];
  private gesture: Gesture | null = null;
  private creationRevision = 0;
  private committing = false;
  private copied: Drawing | null = null;
  private generation = -1;
  private selectedValue: Drawing | undefined;
  private options: DrawingOptions = {
    magnet: 'off',
    stayInDrawingMode: false,
    hidden: false,
    style: { ...DEFAULT_DRAWING_STYLE },
    text: 'Note',
    toolDefaults: {},
  };
  private hovered: string | null = null;

  constructor(host: ControllerHost) {
    this.host = host;
  }
  get currentTool(): string {
    return this.tool;
  }
  get interacting(): boolean {
    return !!this.gesture || !!this.draft;
  }
  /** The drawing under the pointer while idle, whose handles show faintly. */
  get hoverId(): string | null {
    return this.tool === 'cursor' && !this.gesture && !this.options.hidden ? this.hovered : null;
  }
  get selected(): Drawing | undefined {
    return this.host.state().document.drawings.find(d => d.id === this.selectedId);
  }
  inspect(): DrawingInteractionState {
    return structuredClone({
      tool: this.tool,
      selected: this.selected ?? null,
      creating: !!this.draft && !this.gesture,
      options: this.options,
    });
  }
  private emit(): void {
    this.selectedValue = this.selected;
    this.host.changed(this.inspect());
  }
  setTool(tool: string): void {
    if (tool !== 'cursor' && !this.host.registry.get(tool))
      throw new ChartError('UNKNOWN_DRAWING_TOOL', `${tool}`);
    this.cancel(false);
    this.tool = tool;
    this.selectedId = null;
    this.emit();
  }
  select(id: string | null): void {
    if (id !== null && !this.host.state().document.drawings.some(d => d.id === id))
      throw new ChartError('DRAWING_NOT_FOUND');
    this.cancel(false);
    this.tool = 'cursor';
    this.selectedId = id;
    this.emit();
  }
  configure(value: DrawingOptionsPatch): void {
    const toolDefaults = { ...this.options.toolDefaults };
    for (const [type, given] of Object.entries(value.toolDefaults ?? {})) {
      // Validated against the tool so a bad default fails here, not at the next placement.
      if (given === null) {
        if (!this.host.registry.get(type)) throw new ChartError('UNKNOWN_DRAWING_TOOL', type);
        delete toolDefaults[type];
      } else toolDefaults[type] = this.host.registry.validateDefaults(type, given);
    }
    const next = {
      ...this.options,
      ...value,
      style: { ...this.options.style, ...value.style },
      toolDefaults,
    };
    if (
      !['off', 'weak', 'strong'].includes(next.magnet) ||
      typeof next.hidden !== 'boolean' ||
      typeof next.stayInDrawingMode !== 'boolean'
    )
      throw new ChartError('INVALID_DRAWING_OPTIONS');
    this.host.registry.normalize({
      id: 'options',
      type: 'text',
      points: [{ timeMs: 0, price: 1 }],
      style: next.style,
      text: next.text,
    });
    this.options = next;
    if (next.hidden) this.cancel(false);
    this.emit();
  }
  sync(state: RuntimeState): void {
    if (this.generation !== state.generation) {
      this.cancel(false);
      this.selectedId = null;
      this.copied = null;
      this.tool = 'cursor';
      this.generation = state.generation;
      this.emit();
    }
    const expected = this.gesture?.revision ?? (this.draft ? this.creationRevision : null);
    if (!this.committing && expected !== null && expected !== state.documentRevision) this.cancel();
    const selected = this.selected;
    if (this.selectedId && !selected) this.selectedId = null;
    if (selected !== this.selectedValue) {
      this.selectedValue = selected;
      this.emit();
    }
  }
  cancel(notify = true): void {
    const wasInteracting = this.interacting;
    this.draft = null;
    this.fixed = [];
    this.gesture = null;
    // Wheel/host commands also cancel when idle. Do not rebuild host controls then.
    if (notify && wasInteracting) this.emit();
  }
  visible(): Drawing[] {
    if (this.options.hidden) return [];
    const all = this.host.state().document.drawings;
    if (!this.draft) return all;
    return all.some(d => d.id === this.draft!.id)
      ? all.map(d => (d.id === this.draft!.id ? this.draft! : d))
      : [...all, this.draft];
  }
  selectionId(): string | null {
    return this.draft?.id ?? this.selectedId;
  }
  cursor(p: DrawingPoint, context: DrawingContext): string {
    if (this.tool !== 'cursor') return 'crosshair';
    if (this.gesture) return this.gesture.cursor ?? 'move';
    if (this.options.hidden) return 'crosshair';
    const hit = hitDrawings(
      this.host.state().document.drawings,
      this.host.registry,
      context,
      p,
      this.selectedId,
    );
    this.hovered = hit?.drawing.id ?? null;
    return hit?.cursor ?? 'crosshair';
  }
  leave(): void {
    this.hovered = null;
  }
  /** Snaps `to` onto the nearest 45° ray from `from`, measured on screen. */
  private constrain(from: Anchor, to: Anchor, context: DrawingContext): Anchor {
    const g = context.geometry,
      a = { x: g.x(from.timeMs), y: g.y(from.price) },
      b = { x: g.x(to.timeMs), y: g.y(to.price) };
    const step = Math.PI / 4,
      snapped = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
    const length = Math.hypot(b.x - a.x, b.y - a.y),
      dx = Math.round(Math.cos(snapped) * 1e6) / 1e6,
      dy = Math.round(Math.sin(snapped) * 1e6) / 1e6;
    if (dy === 0) return { timeMs: to.timeMs, price: from.price };
    if (dx === 0) return { timeMs: from.timeMs, price: to.price };
    const anchor = g.anchor(a.x + dx * length, a.y + dy * length);
    anchor.price = Math.max(this.host.state().feed.instrument.tickSize, anchor.price);
    return anchor;
  }
  private anchor(p: DrawingPoint, context: DrawingContext, snap = true): Anchor {
    const state = this.host.state(),
      g = context.geometry;
    const anchor = g.anchor(p.x, p.y);
    anchor.price = Math.max(state.feed.instrument.tickSize, anchor.price);
    if (!snap || this.options.magnet === 'off') return anchor;
    let best = Infinity,
      snapped = anchor;
    for (const bar of state.candles) {
      const x = g.x(bar.timeMs + state.feed.intervalMs / 2);
      if (x < g.left || x > g.left + g.plotWidth) continue;
      for (const price of [bar.open, bar.high, bar.low, bar.close]) {
        const distance = Math.hypot(x - p.x, g.y(price) - p.y);
        if (distance < best) {
          best = distance;
          snapped = { timeMs: bar.timeMs + state.feed.intervalMs / 2, price };
        }
      }
    }
    return this.options.magnet === 'strong' || best <= 12 ? snapped : anchor;
  }
  /** A `fixedToPlot` drawing stores where its first anchor now sits on the plot. */
  private pin(drawing: Drawing, context: DrawingContext): void {
    const p = drawing.points[0],
      g = context.geometry;
    if (!p || !this.host.registry.get(drawing.type)?.fixedToPlot) return;
    drawing.options = { ...drawing.options, ...plotOptions({ x: g.x(p.timeMs), y: g.y(p.price) }, context) };
  }
  /** Moves a `fixedToPlot` drawing's anchor to where it is drawn, so a drag starts from there. */
  private unpin(drawing: Drawing, context: DrawingContext): Drawing {
    const at = this.host.registry.get(drawing.type)?.fixedToPlot ? plotPoint(drawing, context) : undefined;
    if (!at) return drawing;
    const anchor = context.geometry.anchor(at.x, at.y);
    anchor.price = Math.max(this.host.state().feed.instrument.tickSize, anchor.price);
    return { ...structuredClone(drawing), points: [anchor, ...drawing.points.slice(1)] };
  }
  private create(points: Anchor[]): Drawing {
    const defaults = this.options.toolDefaults[this.tool];
    return {
      id: crypto.randomUUID(),
      type: this.tool,
      points,
      style: { ...this.options.style, ...defaults?.style },
      visible: true,
      locked: false,
      // Only annotations start with placeholder text; lines show text once the user adds it.
      text: this.host.registry.get(this.tool)?.editableText ? this.options.text : '',
      levels: [...(defaults?.levels ?? [])],
      ...(defaults?.options && Object.keys(defaults.options).length
        ? { options: { ...defaults.options } }
        : {}),
    };
  }
  down(p: DrawingPoint, context: DrawingContext, modifiers: DrawingModifiers = {}): boolean {
    if (this.options.hidden) return false;
    const anchor = this.anchor(p, context),
      state = this.host.state();
    if (this.tool === 'cursor') {
      const hit = hitDrawings(state.document.drawings, this.host.registry, context, p, this.selectedId);
      this.selectedId = hit?.drawing.id ?? null;
      this.emit();
      if (!hit) return false;
      if (!hit.drawing.locked && this.host.registry.get(hit.drawing.type)) {
        const clone = hit.handle === null && !!modifiers.clone;
        // A clone drags under a new id, so the original stays drawn in place.
        const original = this.unpin(
          clone ? { ...structuredClone(hit.drawing), id: crypto.randomUUID() } : hit.drawing,
          context,
        );
        this.draft = structuredClone(original);
        this.gesture = {
          mode: hit.handle === null ? 'body' : 'handle',
          original,
          start: this.anchor(p, context, false),
          pointer: p,
          handle: hit.handle,
          cursor: hit.cursor,
          revision: state.documentRevision,
          clone,
        };
      }
      return true;
    }
    const definition = this.host.registry.get(this.tool)!;
    if (!this.draft) {
      this.creationRevision = state.documentRevision;
      if (definition.create) {
        this.draft = this.create(
          definition.create(anchor, { ...context, tickSize: state.feed.instrument.tickSize }),
        );
        this.pin(this.draft, context);
        this.commit();
        return true;
      }
      this.draft = this.create([anchor]);
      this.pin(this.draft, context);
      this.fixed = [anchor];
      this.emit();
      if (definition.points === 'freehand')
        this.gesture = {
          mode: 'freehand',
          original: this.draft,
          start: anchor,
          pointer: p,
          handle: null,
          revision: state.documentRevision,
        };
      else if (definition.points === 1) this.commit();
    } else if (!this.gesture) {
      const last = this.fixed.at(-1)!,
        next = modifiers.shift ? this.constrain(last, anchor, context) : anchor;
      if (definition.points !== 'path' || last.timeMs !== next.timeMs || last.price !== next.price)
        this.fixed.push(next);
      this.draft.points = [...this.fixed];
      if (typeof definition.points === 'number' && this.fixed.length === definition.points) this.commit();
      else if (this.fixed.length >= 1024) this.commit();
    }
    return true;
  }
  move(p: DrawingPoint, context: DrawingContext, modifiers: DrawingModifiers = {}): boolean {
    if (!this.draft) return false;
    const anchor = this.anchor(p, context);
    if (this.gesture && this.gesture.mode !== 'freehand') {
      this.gesture.moved ||= Math.hypot(p.x - this.gesture.pointer.x, p.y - this.gesture.pointer.y) >= 3;
      if (!this.gesture.moved) return true;
    }
    if (this.gesture?.mode === 'body') {
      const raw = this.anchor(p, context, false);
      this.draft = translateDrawing(
        this.gesture.original,
        raw.timeMs - this.gesture.start.timeMs,
        raw.price - this.gesture.start.price,
        this.host.state().feed.instrument.tickSize,
      );
    } else if (this.gesture?.mode === 'handle') {
      const definition = this.host.registry.get(this.gesture.original.type)!;
      const custom =
        typeof this.gesture.handle === 'string'
          ? drawingHandles(this.gesture.original, this.host.registry, context).find(
              handle => handle.id === this.gesture!.handle,
            )
          : undefined;
      const raw = this.anchor(p, context, false),
        original = custom
          ? context.geometry.anchor(custom.at.x, custom.at.y)
          : this.gesture.original.points[this.gesture.handle as number];
      const moved = {
        timeMs: original.timeMs + raw.timeMs - this.gesture.start.timeMs,
        price: Math.max(
          this.host.state().feed.instrument.tickSize,
          original.price + raw.price - this.gesture.start.price,
        ),
      };
      const snapped =
        this.options.magnet === 'off' || custom?.cursor === 'ew-resize'
          ? moved
          : this.anchor({ x: context.geometry.x(moved.timeMs), y: context.geometry.y(moved.price) }, context);
      if (typeof this.gesture.handle === 'string' && definition.moveHandle)
        this.draft.points = definition.moveHandle(this.gesture.original, this.gesture.handle, snapped, {
          ...context,
          tickSize: this.host.state().feed.instrument.tickSize,
        });
      else {
        const index = this.gesture.handle as number,
          points = this.gesture.original.points,
          other = points[index === 0 ? 1 : index - 1];
        this.draft.points[index] =
          modifiers.shift && other ? this.constrain(other, snapped, context) : snapped;
      }
    } else if (this.gesture?.mode === 'freehand') {
      if (
        Math.hypot(p.x - this.gesture.pointer.x, p.y - this.gesture.pointer.y) >= 3 &&
        this.draft.points.length < 1024
      ) {
        this.draft.points.push(anchor);
        this.gesture.pointer = p;
      }
    } else
      this.draft.points = [
        ...this.fixed,
        modifiers.shift ? this.constrain(this.fixed.at(-1)!, anchor, context) : anchor,
      ];
    this.pin(this.draft, context);
    return true;
  }
  up(p: DrawingPoint, context: DrawingContext, modifiers: DrawingModifiers = {}): void {
    if (!this.gesture || !this.draft) return;
    this.move(p, context, modifiers);
    if (this.gesture.mode === 'freehand' && this.draft.points.length < 2) {
      this.cancel();
      return;
    }
    if (
      this.gesture.mode !== 'freehand' &&
      JSON.stringify(this.draft.points) === JSON.stringify(this.gesture.original.points)
    ) {
      this.cancel();
      return;
    }
    this.commit();
  }
  finish(): void {
    if (
      this.draft &&
      !this.gesture &&
      this.host.registry.get(this.tool)?.points === 'path' &&
      this.fixed.length >= 2
    ) {
      this.draft.points = [...this.fixed];
      this.commit();
    }
  }
  private commit(): void {
    if (!this.draft) return;
    const draft = this.draft,
      cloning = !!this.gesture?.clone,
      editing = this.gesture && this.gesture.mode !== 'freehand' && !cloning;
    const revision = this.gesture?.revision ?? this.creationRevision,
      pinned = this.host.registry.get(draft.type)?.fixedToPlot && draft.options;
    this.committing = true;
    try {
      this.host.execute(
        editing
          ? {
              type: 'drawing.update',
              id: draft.id,
              patch: { points: draft.points, ...(pinned ? { options: pinned } : {}) },
            }
          : { type: 'drawing.add', drawing: draft },
        revision,
      );
      this.selectedId = draft.id;
      if (!editing && !this.options.stayInDrawingMode) this.tool = 'cursor';
    } catch (error) {
      this.host.error(toChartError(error));
    } finally {
      this.committing = false;
      this.cancel(false);
      this.emit();
    }
  }
  copy(): void {
    this.copied = this.selected ? structuredClone(this.selected) : null;
  }
  paste(): void {
    if (!this.copied) return;
    const offset = this.host.state().feed.intervalMs * 3;
    const drawing = translateDrawing(this.copied, offset, 0, this.host.state().feed.instrument.tickSize);
    drawing.id = crypto.randomUUID();
    drawing.locked = false;
    drawing.visible = true;
    this.host.execute({ type: 'drawing.add', drawing });
    this.select(drawing.id);
    this.copied = structuredClone(drawing);
  }
}
