import type { Anchor } from './types.ts';
import type { Drawing, DrawingContext, DrawingHandle } from './drawing-types.ts';

export const isPosition = (drawing: Pick<Drawing, 'type'> | undefined | null): boolean => drawing?.type === 'long-position' || drawing?.type === 'short-position';
export const positionDirection = (type: string): number => type === 'long-position' ? 1 : -1;

export function positionMetrics(drawing: Pick<Drawing, 'type' | 'points'>) {
  const [entry, target, stop] = drawing.points, direction = positionDirection(drawing.type);
  const reward = (target.price - entry.price) * direction, risk = (entry.price - stop.price) * direction;
  return { reward, risk, ratio: reward / risk, rewardPercent: reward / entry.price * 100, riskPercent: risk / entry.price * 100 };
}

/** Retains the existing three-anchor document format, while giving each level one job. */
export function createPosition(type: string, anchor: Anchor, context: DrawingContext): Anchor[] {
  const g = context.geometry, tick = context.tickSize ?? Math.max(Number.EPSILON, anchor.price * 1e-8);
  const entry = { ...anchor, price: Math.max(tick * 2, anchor.price) };
  const distance = Math.max(tick, Math.min((g.maxPrice - g.minPrice) * 0.18, entry.price - tick));
  const pixels = Math.min(300, Math.max(120, g.plotWidth * 0.3)), x = g.x(entry.timeMs);
  const end = g.anchor(x + (x + pixels > g.left + g.plotWidth ? -pixels : pixels), g.y(entry.price)).timeMs;
  const direction = positionDirection(type);
  return [entry, { timeMs: end, price: entry.price + direction * distance }, { timeMs: end, price: entry.price - direction * distance }];
}

export function positionHandles(drawing: Drawing, { geometry: g }: DrawingContext): DrawingHandle[] {
  if (drawing.points.length < 3) return [];
  const [entry, target, stop] = drawing.points, start = g.x(entry.timeMs), end = g.x(target.timeMs), middle = (start + end) / 2;
  return [
    { id: 'entry', at: { x: start, y: g.y(entry.price) }, cursor: 'ns-resize' },
    { id: 'target', at: { x: middle, y: g.y(target.price) }, cursor: 'ns-resize' },
    { id: 'stop', at: { x: middle, y: g.y(stop.price) }, cursor: 'ns-resize' },
    { id: 'extent', at: { x: end, y: g.y(entry.price) }, cursor: 'ew-resize' },
  ];
}

export function movePositionHandle(drawing: Drawing, handle: string, anchor: Anchor, context: DrawingContext): Anchor[] {
  const points = drawing.points.map(point => ({ ...point })), [entry, target, stop] = points;
  const direction = positionDirection(drawing.type), tick = Math.min(context.tickSize ?? Math.max(Number.EPSILON, entry.price * 1e-8), entry.price / 2);
  if (handle === 'target') target.price = direction > 0 ? Math.max(entry.price + tick, anchor.price) : Math.max(tick, Math.min(entry.price - tick, anchor.price));
  else if (handle === 'stop') stop.price = direction > 0 ? Math.max(tick, Math.min(entry.price - tick, anchor.price)) : Math.max(entry.price + tick, anchor.price);
  else if (handle === 'entry') {
    const gap = Math.min(tick, Math.abs(target.price - stop.price) / 3);
    entry.price = Math.max(Math.min(target.price, stop.price) + gap, Math.min(Math.max(target.price, stop.price) - gap, anchor.price));
  }
  else if (handle === 'extent') {
    const sign = Math.sign(target.timeMs - entry.timeMs) || 1, minimum = context.intervalMs;
    target.timeMs = entry.timeMs + sign * Math.max(minimum, (anchor.timeMs - entry.timeMs) * sign);
    stop.timeMs = target.timeMs;
  }
  return points;
}
