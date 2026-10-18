import { ChartError, toChartError } from './errors.ts';
import { DEFAULT_DRAWING_STYLE, DrawingRegistry, translateDrawing } from './drawing-tools.ts';
import { drawingHandles, hitDrawings, sceneTouchesRect, type DrawingRect } from './drawing-scene.ts';
import { groupOf } from './drawing-groups.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingGroup,
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
  /** A list is one atomic batch and one undo step. */
  execute(command: ChartCommand | readonly ChartCommand[], revision?: number): void;
  changed(state: DrawingInteractionState): void;
  error(error: Error): void;
}
interface Gesture {
  mode: 'body' | 'handle' | 'freehand';
  original: Drawing;
  /** Other selected drawings that a body drag moves with `original`. */
  others: Drawing[];
  /** Ids a modifier click adds to or removes from the selection when the pointer does not move. */
  toggle?: string[];
  start: Anchor;
  pointer: DrawingPoint;
  handle: number | string | null;
  cursor?: string;
  revision: number;
  moved?: boolean;
  /** Commit as a new drawing and leave the original in place. */
  clone?: boolean;
  /** Source id to clone id, for clones. */
  copies?: Map<string, string>;
}

/** Owns unfinished drawing gestures. Only completed edits reach the runtime. */
export class DrawingController {
  private host: ControllerHost;
  private tool = 'cursor';
  /** Back to front is not kept here; the last id is the primary selection. */
  private selectedIds: string[] = [];
  private draft: Drawing | null = null;
  /** Drafts of `gesture.others`. */
  private extra: Drawing[] = [];
  private box: { from: DrawingPoint; to: DrawingPoint; base: string[]; context: DrawingContext } | null =
    null;
  private fixed: Anchor[] = [];
  private gesture: Gesture | null = null;
  private creationRevision = 0;
  private committing = false;
  private copied: { drawings: Drawing[]; groups: DrawingGroup[] } | null = null;
  private generation = -1;
  private selectionValue: Drawing[] = [];
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
    return !!this.gesture || !!this.draft || !!this.box;
  }
  /** The drawing under the pointer while idle, whose handles show faintly. */
  get hoverId(): string | null {
    return this.tool === 'cursor' && !this.gesture && !this.box && !this.options.hidden ? this.hovered : null;
  }
  /** The most recently selected drawing. */
  get selected(): Drawing | undefined {
    const drawings = this.host.state().document.drawings;
    for (let i = this.selectedIds.length - 1; i >= 0; i--) {
      const found = drawings.find(d => d.id === this.selectedIds[i]);
      if (found) return found;
    }
    return undefined;
  }
  /** Every selected drawing, back to front. */
  get selection(): Drawing[] {
    const ids = new Set(this.selectedIds);
    return this.host.state().document.drawings.filter(d => ids.has(d.id));
  }
  /** The selection box being dragged, in CSS pixels. */
  get marquee(): DrawingRect | null {
    const box = this.box;
    if (!box) return null;
    return {
      left: Math.min(box.from.x, box.to.x),
      top: Math.min(box.from.y, box.to.y),
      right: Math.max(box.from.x, box.to.x),
      bottom: Math.max(box.from.y, box.to.y),
    };
  }
  inspect(): DrawingInteractionState {
    return structuredClone({
      tool: this.tool,
      selected: this.selected ?? null,
      selection: this.selection,
      creating: !!this.draft && !this.gesture,
      options: this.options,
    });
  }
  private emit(): void {
    this.selectionValue = this.selection;
    this.host.changed(this.inspect());
  }
  setTool(tool: string): void {
    if (tool !== 'cursor' && !this.host.registry.get(tool))
      throw new ChartError('UNKNOWN_DRAWING_TOOL', `${tool}`);
    this.cancel(false);
    this.tool = tool;
    this.selectedIds = [];
    this.emit();
  }
  /** Selects one drawing, several (the last becomes `selected`), or none. */
  select(id: string | readonly string[] | null): void {
    const ids = id === null ? [] : typeof id === 'string' ? [id] : [...new Set(id)];
    const drawings = this.host.state().document.drawings;
    if (!Array.isArray(ids) || ids.some(id => !drawings.some(d => d.id === id)))
      throw new ChartError('DRAWING_NOT_FOUND');
    this.cancel(false);
    this.tool = 'cursor';
    this.selectedIds = ids;
    this.emit();
  }
  /** The ids a click on `id` selects: its whole group, with `id` last. */
  private members(id: string): string[] {
    const group = groupOf(this.host.state().document.drawingGroups, id);
    return group ? [...group.drawings.filter(member => member !== id), id] : [id];
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
      this.selectedIds = [];
      this.copied = null;
      this.tool = 'cursor';
      this.generation = state.generation;
      this.emit();
    }
    const expected = this.gesture?.revision ?? (this.draft ? this.creationRevision : null);
    if (!this.committing && expected !== null && expected !== state.documentRevision) this.cancel();
    const drawings = state.document.drawings;
    if (this.selectedIds.some(id => !drawings.some(d => d.id === id)))
      this.selectedIds = this.selectedIds.filter(id => drawings.some(d => d.id === id));
    const selection = this.selection;
    if (
      selection.length !== this.selectionValue.length ||
      selection.some((d, i) => d !== this.selectionValue[i])
    )
      this.emit();
  }
  cancel(notify = true): void {
    const wasInteracting = this.interacting;
    this.draft = null;
    this.extra = [];
    this.box = null;
    this.fixed = [];
    this.gesture = null;
    // Wheel/host commands also cancel when idle. Do not rebuild host controls then.
    if (notify && wasInteracting) this.emit();
  }
  visible(): Drawing[] {
    if (this.options.hidden) return [];
    const all = this.host.state().document.drawings;
    if (!this.draft) return all;
    const drafts = new Map([this.draft, ...this.extra].map(d => [d.id, d]));
    const shown = all.map(d => drafts.get(d.id) ?? d);
    // Clones and new drawings draw in front.
    return [...shown, ...[...drafts.values()].filter(d => !all.some(a => a.id === d.id))];
  }
  /** The ids drawn as selected: an unfinished draft and its companions, else the selection. */
  selectionIds(): string[] {
    if (!this.draft) return [...this.selectedIds];
    const ids = [...this.extra.map(d => d.id), this.draft.id];
    // A moved selection stays selected; a new drawing or clone shows alone.
    return this.gesture?.mode === 'body' && !this.gesture.clone
      ? [...new Set([...this.selectedIds, ...ids])]
      : ids;
  }
  cursor(p: DrawingPoint, context: DrawingContext): string {
    if (this.tool !== 'cursor') return 'crosshair';
    if (this.gesture) return this.gesture.cursor ?? 'move';
    if (this.box || this.options.hidden) return 'crosshair';
    const hit = hitDrawings(
      this.host.state().document.drawings,
      this.host.registry,
      context,
      p,
      this.selectedIds,
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
      ...(defaults?.levelStyles?.length ? { levelStyles: structuredClone(defaults.levelStyles) } : {}),
      ...(defaults?.options && Object.keys(defaults.options).length
        ? { options: { ...defaults.options } }
        : {}),
      ...(defaults?.visibility ? { visibility: structuredClone(defaults.visibility) } : {}),
    };
  }
  down(p: DrawingPoint, context: DrawingContext, modifiers: DrawingModifiers = {}): boolean {
    if (this.options.hidden) return false;
    const anchor = this.anchor(p, context),
      state = this.host.state();
    if (this.tool === 'cursor') {
      const hit = hitDrawings(state.document.drawings, this.host.registry, context, p, this.selectedIds);
      if (!hit) {
        // A modifier drag on empty plot draws a selection box that adds to the selection.
        if (modifiers.toggle) {
          this.box = { from: p, to: p, base: [...this.selectedIds], context };
          return true;
        }
        if (this.selectedIds.length) {
          this.selectedIds = [];
          this.emit();
        }
        return false;
      }
      const id = hit.drawing.id,
        members = this.members(id),
        wasSelected = this.selectedIds.includes(id);
      // A handle edits one drawing and keeps the selection. A modifier click waits for release.
      if (hit.handle !== null || (wasSelected && !modifiers.toggle))
        this.selectedIds = [...this.selectedIds.filter(s => s !== id), id];
      else if (!modifiers.toggle) this.selectedIds = members;
      this.emit();
      const toggle = modifiers.toggle && hit.handle === null ? members : undefined;
      if (!hit.drawing.locked && this.host.registry.get(hit.drawing.type)) {
        const clone = hit.handle === null && !!modifiers.clone;
        const together = new Set(
          hit.handle !== null
            ? []
            : toggle && !wasSelected
              ? [...this.selectedIds, ...members]
              : this.selectedIds,
        );
        const copies = new Map<string, string>();
        // A clone drags under a new id, so the original stays drawn in place.
        const copy = (d: Drawing) => {
          if (!clone) return d;
          copies.set(d.id, crypto.randomUUID());
          return { ...structuredClone(d), id: copies.get(d.id)! };
        };
        // Hidden, locked and unregistered drawings stay where they are.
        const others = state.document.drawings
          .filter(
            d =>
              d.id !== id && together.has(d.id) && d.visible && !d.locked && this.host.registry.get(d.type),
          )
          .map(copy);
        const original = copy(hit.drawing);
        this.draft = structuredClone(original);
        this.extra = structuredClone(others);
        this.gesture = {
          mode: hit.handle === null ? 'body' : 'handle',
          original,
          others,
          toggle,
          start: this.anchor(p, context, false),
          pointer: p,
          handle: hit.handle,
          cursor: hit.cursor,
          revision: state.documentRevision,
          clone,
          copies,
        };
      } else if (toggle) this.toggle(toggle);
      return true;
    }
    const definition = this.host.registry.get(this.tool)!;
    if (!this.draft) {
      this.creationRevision = state.documentRevision;
      if (definition.create) {
        this.draft = this.create(
          definition.create(anchor, { ...context, tickSize: state.feed.instrument.tickSize }),
        );
        this.commit();
        return true;
      }
      this.draft = this.create([anchor]);
      this.fixed = [anchor];
      this.emit();
      if (definition.points === 'freehand')
        this.gesture = {
          mode: 'freehand',
          original: this.draft,
          others: [],
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
    if (this.box) {
      this.box.to = p;
      return true;
    }
    if (!this.draft) return false;
    const anchor = this.anchor(p, context);
    if (this.gesture && this.gesture.mode !== 'freehand') {
      this.gesture.moved ||= Math.hypot(p.x - this.gesture.pointer.x, p.y - this.gesture.pointer.y) >= 3;
      if (!this.gesture.moved) return true;
    }
    if (this.gesture?.mode === 'body') {
      const raw = this.anchor(p, context, false),
        dt = raw.timeMs - this.gesture.start.timeMs,
        dp = raw.price - this.gesture.start.price,
        tick = this.host.state().feed.instrument.tickSize;
      this.draft = translateDrawing(this.gesture.original, dt, dp, tick);
      this.extra = this.gesture.others.map(d => translateDrawing(d, dt, dp, tick));
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
    return true;
  }
  up(p: DrawingPoint, context: DrawingContext, modifiers: DrawingModifiers = {}): void {
    if (this.box) {
      this.box.to = p;
      this.finishBox();
      return;
    }
    if (!this.gesture || !this.draft) return;
    this.move(p, context, modifiers);
    if (this.gesture.toggle && !this.gesture.moved) {
      const ids = this.gesture.toggle;
      this.cancel(false);
      this.toggle(ids);
      return;
    }
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
  /** Adds `ids` to the selection, or removes them when all are already selected. */
  private toggle(ids: string[]): void {
    const all = ids.every(id => this.selectedIds.includes(id));
    this.selectedIds = all
      ? this.selectedIds.filter(id => !ids.includes(id))
      : [...this.selectedIds.filter(id => !ids.includes(id)), ...ids];
    this.emit();
  }
  private finishBox(): void {
    const box = this.box!,
      rect = this.marquee!;
    this.box = null;
    if (rect.right - rect.left < 3 && rect.bottom - rect.top < 3) {
      this.emit();
      return;
    }
    const caught = this.host
      .state()
      .document.drawings.filter(
        d =>
          d.visible &&
          this.host.registry.get(d.type) &&
          sceneTouchesRect(this.host.registry.project(d, box.context), d, rect, box.context),
      );
    const ids = caught.flatMap(d => this.members(d.id));
    this.selectedIds = [...new Set([...box.base.filter(id => !ids.includes(id)), ...ids])];
    this.emit();
  }
  /** Commands that recreate each group whose members were all copied, under the copies' ids. */
  private regroup(groups: readonly DrawingGroup[], ids: Map<string, string>): ChartCommand[] {
    return groups
      .filter(group => group.drawings.every(id => ids.has(id)))
      .map(group => ({
        type: 'drawing.group',
        id: crypto.randomUUID(),
        name: group.name,
        drawingIds: group.drawings.map(id => ids.get(id)!),
      }));
  }
  private commit(): void {
    if (!this.draft) return;
    const draft = this.draft,
      extra = this.extra,
      cloning = !!this.gesture?.clone,
      editing = this.gesture && this.gesture.mode !== 'freehand' && !cloning;
    const revision = this.gesture?.revision ?? this.creationRevision;
    const drafts = [...extra, draft];
    const commands: ChartCommand[] = drafts.map(d =>
      editing
        ? { type: 'drawing.update', id: d.id, patch: { points: d.points } }
        : { type: 'drawing.add', drawing: d },
    );
    if (cloning && this.gesture?.copies)
      commands.push(...this.regroup(this.host.state().document.drawingGroups ?? [], this.gesture.copies));
    this.committing = true;
    try {
      this.host.execute(commands.length === 1 ? commands[0] : commands, revision);
      const ids = drafts.map(d => d.id).filter(id => id !== draft.id);
      this.selectedIds =
        editing && this.gesture?.mode === 'body'
          ? [...new Set([...this.selectedIds.filter(id => id !== draft.id), ...ids, draft.id])]
          : editing
            ? [...this.selectedIds.filter(id => id !== draft.id), draft.id]
            : [...ids, draft.id];
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
    const drawings = this.selection,
      ids = new Set(drawings.map(d => d.id));
    this.copied = drawings.length
      ? structuredClone({
          drawings,
          groups: (this.host.state().document.drawingGroups ?? []).filter(g =>
            g.drawings.every(id => ids.has(id)),
          ),
        })
      : null;
  }
  /** Adds the copied drawings three bars right as one undo step and selects them. */
  paste(): void {
    if (!this.copied) return;
    const state = this.host.state(),
      offset = state.feed.intervalMs * 3,
      ids = new Map<string, string>();
    const drawings = this.copied.drawings.map(source => {
      const drawing = translateDrawing(source, offset, 0, state.feed.instrument.tickSize);
      drawing.id = crypto.randomUUID();
      drawing.locked = false;
      drawing.visible = true;
      ids.set(source.id, drawing.id);
      return drawing;
    });
    const groups = this.copied.groups.map(g => ({ ...g, drawings: g.drawings.map(id => ids.get(id)!) }));
    const commands: ChartCommand[] = [
      ...drawings.map(drawing => ({ type: 'drawing.add' as const, drawing })),
      ...this.regroup(this.copied.groups, ids),
    ];
    this.host.execute(commands.length === 1 ? commands[0] : commands);
    this.select(drawings.map(d => d.id));
    this.copied = structuredClone({ drawings, groups });
  }
  /** Copies the selection three bars right as one undo step and selects the copies. */
  duplicate(): void {
    const selection = this.selection;
    if (!selection.length) return;
    const ids = new Map(selection.map(d => [d.id, crypto.randomUUID()]));
    const offset = { timeMs: this.host.state().feed.intervalMs * 3, price: 0 };
    const commands: ChartCommand[] = [
      ...selection.map(d => ({
        type: 'drawing.duplicate' as const,
        id: d.id,
        newId: ids.get(d.id)!,
        offset,
      })),
      ...this.regroup(this.host.state().document.drawingGroups ?? [], ids),
    ];
    this.host.execute(commands.length === 1 ? commands[0] : commands);
    this.select([...ids.values()]);
  }
  /** Deletes the unlocked selected drawings as one undo step. */
  remove(): void {
    const commands: ChartCommand[] = this.selection
      .filter(d => !d.locked)
      .map(d => ({ type: 'drawing.remove', id: d.id }));
    if (commands.length) this.host.execute(commands.length === 1 ? commands[0] : commands);
  }
  /** Groups the selection under a new id and returns it, or null with nothing selected. */
  group(name?: string): string | null {
    const ids = this.selection.map(d => d.id);
    if (!ids.length) return null;
    const id = crypto.randomUUID();
    this.host.execute({ type: 'drawing.group', id, drawingIds: ids, ...(name ? { name } : {}) });
    return id;
  }
  /** Removes every group that has a selected member. The drawings stay selected. */
  ungroup(): void {
    const ids = new Set(this.selectedIds);
    const commands: ChartCommand[] = (this.host.state().document.drawingGroups ?? [])
      .filter(g => g.drawings.some(id => ids.has(id)))
      .map(g => ({ type: 'drawing.ungroup', id: g.id }));
    if (commands.length) this.host.execute(commands.length === 1 ? commands[0] : commands);
  }
}
