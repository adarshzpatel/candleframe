/** Drag right to widen candle spacing, keeping the right edge fixed. */
export function dragTimeScale(
  fromMs: number,
  toMs: number,
  deltaX: number,
  width: number,
  intervalMs: number,
) {
  const factor = Math.exp(Math.max(-8, Math.min(8, (-deltaX / Math.max(1, width)) * 3)));
  const span = Math.max(25 * intervalMs, Math.min(2200 * intervalMs, (toMs - fromMs) * factor));
  return { fromMs: toMs - span, toMs };
}

/** Drag up to widen price spacing around the initial range's midpoint. */
export function dragPriceScale(
  minPrice: number,
  maxPrice: number,
  deltaY: number,
  height: number,
  tickSize: number,
) {
  const center = minPrice + (maxPrice - minPrice) / 2;
  const factor = Math.exp(Math.max(-8, Math.min(8, (deltaY / Math.max(1, height)) * 3)));
  const span = Math.max(tickSize * 2, Math.min((center - tickSize) * 2, (maxPrice - minPrice) * factor));
  return { minPrice: Math.max(tickSize, center - span / 2), maxPrice: center + span / 2 };
}

/** Translate the range so a price follows the pointer, without changing its span. */
export function panPriceScale(
  minPrice: number,
  maxPrice: number,
  deltaY: number,
  height: number,
  tickSize: number,
) {
  const span = maxPrice - minPrice;
  const nextMin = Math.max(tickSize, minPrice + (deltaY / Math.max(1, height)) * span);
  return { minPrice: nextMin, maxPrice: nextMin + span };
}

/** Keep a small data overlap instead of requiring the viewport to fit inside history. */
export function panTimeScale(
  fromMs: number,
  toMs: number,
  deltaX: number,
  width: number,
  history: { firstMs: number; lastMs: number; intervalMs: number },
) {
  const span = toMs - fromMs;
  const end = history.lastMs + history.intervalMs;
  const overlap = Math.min(5 * history.intervalMs, end - history.firstMs, span);
  // Include an existing outlying viewport so restored or keyboard-panned views
  // can move back toward data without jumping to a boundary on pointer-down.
  const minFrom = Math.min(fromMs, history.firstMs + overlap - span);
  const maxFrom = Math.max(fromMs, end - overlap);
  const desired = fromMs - (deltaX / Math.max(1, width)) * span;
  const nextFrom = Math.max(minFrom, Math.min(maxFrom, desired));
  return { fromMs: nextFrom, toMs: nextFrom + span, clamped: nextFrom !== desired };
}

/** Price-axis math in linear or logarithmic space. Log scales drag and pan by ratio. */
export interface PriceAxisMath {
  drag(
    minPrice: number,
    maxPrice: number,
    deltaY: number,
    height: number,
  ): { minPrice: number; maxPrice: number };
  pan(
    minPrice: number,
    maxPrice: number,
    deltaY: number,
    height: number,
  ): { minPrice: number; maxPrice: number };
  /** Pixel offset that moves `from` to `to` on an axis of `height` pixels. */
  offset(from: { minPrice: number; maxPrice: number }, to: { minPrice: number }, height: number): number;
}

export function priceAxisMath(log: boolean, tickSize: number): PriceAxisMath {
  if (!log)
    return {
      drag: (min, max, dy, h) => dragPriceScale(min, max, dy, h, tickSize),
      pan: (min, max, dy, h) => panPriceScale(min, max, dy, h, tickSize),
      offset: (from, to, h) => ((to.minPrice - from.minPrice) / (from.maxPrice - from.minPrice)) * h,
    };
  const floor = Math.log(tickSize);
  return {
    drag(min, max, dy, h) {
      const lo = Math.log(min),
        hi = Math.log(max),
        center = (lo + hi) / 2;
      const factor = Math.exp(Math.max(-8, Math.min(8, (dy / Math.max(1, h)) * 3)));
      const span = Math.max(1e-6, Math.min(40, (hi - lo) * factor));
      const next = Math.max(floor, center - span / 2);
      return { minPrice: Math.exp(next), maxPrice: Math.exp(next + span) };
    },
    pan(min, max, dy, h) {
      const lo = Math.log(min),
        span = Math.log(max) - lo;
      const next = Math.max(floor, lo + (dy / Math.max(1, h)) * span);
      return { minPrice: Math.exp(next), maxPrice: Math.exp(next + span) };
    },
    offset: (from, to, h) =>
      ((Math.log(to.minPrice) - Math.log(from.minPrice)) /
        (Math.log(from.maxPrice) - Math.log(from.minPrice))) *
      h,
  };
}
