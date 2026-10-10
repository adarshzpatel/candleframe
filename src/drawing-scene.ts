import { chartThemes, themeColor } from './themes.ts';
import type { Drawing, DrawingContext, DrawingHandle, DrawingPoint, DrawingPrimitive } from './drawing-types.ts';
import type { DrawingRegistry } from './drawing-tools.ts';

function distanceToSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function contains(p: DrawingPoint, points: DrawingPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function textBox(primitive: Extract<DrawingPrimitive, { kind: 'text' }>, drawing: Drawing, context?: Pick<DrawingContext, 'theme' | 'measureText'>) {
  const size = primitive.size ?? drawing.style.fontSize;
  const theme = context?.theme ?? chartThemes.evergreen;
  const padding = theme.chart.annotationPadding, font = `${size}px ${theme.typography.annotationFamily}`;
  const lines = primitive.text.split('\n');
  const width = Math.max(...lines.map(line => context?.measureText?.(line, font) ?? line.length * size * 0.62)) + padding * 2;
  const x = primitive.at.x - (primitive.align === 'center' ? width / 2 : primitive.align === 'right' ? width : 0);
  return { x, y: primitive.at.y - size - padding / 2, width, height: lines.length * (size + 4) + padding, size, lines, padding, font };
}
export function hitScene(primitives: DrawingPrimitive[], drawing: Drawing, p: DrawingPoint, tolerance = 7, context?: Pick<DrawingContext, 'theme' | 'measureText'>): boolean {
  return primitives.some(primitive => {
    if (primitive.kind === 'text') {
      const b = textBox(primitive, drawing, context);
      return p.x >= b.x - tolerance && p.x <= b.x + b.width + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.height + tolerance;
    }
    const points = primitive.points;
    for (let i = 1; i < points.length; i++) if (distanceToSegment(p, points[i - 1], points[i]) <= tolerance + (primitive.width ?? drawing.style.width) / 2) return true;
    return !!primitive.closed && (contains(p, points) || (points.length > 1 && distanceToSegment(p, points[points.length - 1], points[0]) <= tolerance));
  });
}

export function drawingHandles(drawing: Drawing, registry: DrawingRegistry, context: DrawingContext): DrawingHandle[] {
  const tool = registry.get(drawing.type);
  if (!tool) return [];
  if (tool.handles) return tool.handles(drawing, context);
  const indices = drawing.points.length > 8 ? [0, drawing.points.length - 1] : drawing.points.map((_, index) => index);
  return indices.map(id => ({ id, at: { x: context.geometry.x(drawing.points[id].timeMs), y: context.geometry.y(drawing.points[id].price) }, cursor: 'move' }));
}

export function hitDrawings(drawings: readonly Drawing[], registry: DrawingRegistry, context: DrawingContext, p: DrawingPoint, selectedId: string | null): { drawing: Drawing; handle: number | string | null; cursor: string } | null {
  const g = context.geometry;
  if (p.x < g.left || p.x > g.left + g.plotWidth || p.y < g.top || p.y > g.top + g.plotHeight) return null;
  const selected = drawings.find(d => d.id === selectedId);
  if (selected?.visible && !selected.locked && registry.get(selected.type)) {
    const handle = drawingHandles(selected, registry, context).find(handle => Math.hypot(handle.at.x - p.x, handle.at.y - p.y) <= Math.max(9, (context.theme?.chart.handleRadius ?? 4) + 3));
    if (handle) return { drawing: selected, handle: handle.id, cursor: handle.cursor };
  }
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.visible && hitScene(registry.project(d, context), d, p, 7, context)) return { drawing: d, handle: null, cursor: d.locked ? 'default' : 'move' };
  }
  return null;
}

export function renderDrawings(ctx: CanvasRenderingContext2D, drawings: readonly Drawing[], registry: DrawingRegistry, context: DrawingContext, selectedId: string | null): void {
  const g = context.geometry, theme = context.theme ?? chartThemes.evergreen;
  ctx.save();
  ctx.beginPath(); ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight); ctx.clip();
  for (const d of drawings) {
    if (!d.visible) continue;
    for (const primitive of registry.project(d, context)) {
      ctx.save();
      if (primitive.kind === 'path') {
        if (!primitive.points.length) { ctx.restore(); continue; }
        ctx.beginPath(); ctx.moveTo(primitive.points[0].x, primitive.points[0].y);
        for (const p of primitive.points.slice(1)) ctx.lineTo(p.x, p.y);
        if (primitive.closed) ctx.closePath();
        if (primitive.fill) { ctx.fillStyle = primitive.fill; ctx.globalAlpha = d.style.fillOpacity; ctx.fill(); }
        ctx.globalAlpha = primitive.opacity ?? 1;
        ctx.strokeStyle = primitive.color ?? d.style.color;
        const strokeWidth = primitive.width ?? d.style.width;
        if (strokeWidth > 0) ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.setLineDash(primitive.dash ?? (d.style.lineStyle === 'dashed' ? [7, 5] : d.style.lineStyle === 'dotted' ? [2, 4] : []));
        if (strokeWidth > 0) ctx.stroke();
      } else {
        const b = textBox(primitive, d, context);
        ctx.font = b.font;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = primitive.background ?? themeColor(theme, theme.chart.annotationBackground);
        ctx.globalAlpha = theme.chart.annotationOpacity; ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.globalAlpha = 1; ctx.fillStyle = primitive.color ?? d.style.color;
        b.lines.forEach((line, i) => ctx.fillText(line, b.x + b.padding, b.y + b.size + b.padding / 2 + i * (b.size + 4)));
      }
      ctx.restore();
    }
  }
  const selected = drawings.find(d => d.id === selectedId && d.visible && !d.locked && registry.get(d.type));
  if (selected) {
    for (const handle of drawingHandles(selected, registry, context)) {
      ctx.fillStyle = themeColor(theme, theme.chart.handleFill); ctx.strokeStyle = themeColor(theme, theme.chart.handleColor); ctx.lineWidth = theme.chart.handleWidth; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(handle.at.x, handle.at.y, theme.chart.handleRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}
