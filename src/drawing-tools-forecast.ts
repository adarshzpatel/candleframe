import {
  bars,
  choice,
  drawingOption,
  duration,
  fill,
  line,
  path,
  screen,
  signed,
  text,
  toggle,
  axisTag,
} from './drawing-primitives.ts';
import { buildProfile, type PriceProfile } from './profiles.ts';
import type { Anchor, Candle } from './types.ts';
import type {
  Drawing,
  DrawingContext,
  DrawingHandle,
  DrawingOptionValue,
  DrawingPoint,
  DrawingPrimitive,
  DrawingSetting,
  DrawingToolDefinition,
} from './drawing-types.ts';

/** Projection and volume-based tools (Forecasting family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */

const settingsByType = new Map<string, readonly DrawingSetting[]>();
const option = <T extends DrawingOptionValue>(d: Drawing, key: string): T =>
  drawingOption<T>(d, { settings: settingsByType.get(d.type) }, key);

const tool = (
  type: string,
  label: string,
  section: string,
  points: DrawingToolDefinition['points'],
  project: DrawingToolDefinition['project'],
  extra: Partial<Omit<DrawingToolDefinition, 'type' | 'label' | 'group' | 'points' | 'project'>> = {},
): DrawingToolDefinition => {
  const definition: DrawingToolDefinition = {
    type,
    label,
    group: 'Forecasting',
    section,
    points,
    project,
    hint:
      points === 'path'
        ? 'Click points; press Enter or double-click to finish.'
        : `Click ${points === 1 ? 'one point' : `${points} points`} to place.`,
    ...extra,
  };
  if (definition.settings) settingsByType.set(type, definition.settings);
  return definition;
};
const color = (key: string, label: string, value: string, section?: string): DrawingSetting => ({
  key,
  label,
  kind: 'color',
  default: value,
  ...(section ? { section } : {}),
});
const number = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  section?: string,
): DrawingSetting => ({
  key,
  label,
  kind: 'number',
  default: value,
  min,
  max,
  step,
  ...(section ? { section } : {}),
});

function dot(at: DrawingPoint, radius: number, color?: string): DrawingPrimitive {
  const points = Array.from({ length: 12 }, (_, i) => ({
    x: at.x + radius * Math.cos((i / 12) * Math.PI * 2),
    y: at.y + radius * Math.sin((i / 12) * Math.PI * 2),
  }));
  return path(points, { closed: true, ...(color ? { fill: color, color } : {}), width: 1, opacity: 1 });
}
const finite = (p: DrawingPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** First index whose candle opens at or after `timeMs`. */
function lowerBound(candles: readonly Candle[], timeMs: number): number {
  let lo = 0,
    hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Results keyed by the candle array, which the runtime replaces on every change, plus the
 * drawing's inputs. Panning and zooming reuse the array, so they reuse the result.
 */
function memo<T>(
  store: WeakMap<readonly Candle[], Map<string, T>>,
  candles: readonly Candle[],
  key: string,
  build: () => T,
): T {
  let entries = store.get(candles);
  if (!entries) store.set(candles, (entries = new Map()));
  let value = entries.get(key);
  if (value === undefined) {
    if (entries.size >= 64) entries.clear();
    entries.set(key, (value = build()));
  }
  return value;
}

// Forecast

export interface ForecastOutcome {
  state: 'pending' | 'success' | 'failure';
  /** Bar that reached the target, or the last bar at or before the target time on failure. */
  timeMs?: number;
  price?: number;
}

/**
 * Success once a bar after the source trades through the target price by the target time.
 * Failure once loaded bars pass the target time without reaching it.
 */
export function forecastOutcome(points: readonly Anchor[], candles: readonly Candle[]): ForecastOutcome {
  const [source, target] = points;
  if (!target || target.timeMs <= source.timeMs) return { state: 'pending' };
  const up = target.price >= source.price;
  let last: Candle | undefined;
  for (let i = lowerBound(candles, source.timeMs + 1); i < candles.length; i++) {
    const bar = candles[i];
    if (bar.timeMs > target.timeMs) break;
    last = bar;
    if (up ? bar.high >= target.price : bar.low <= target.price)
      return { state: 'success', timeMs: bar.timeMs, price: target.price };
  }
  const latest = candles.at(-1);
  if (latest && latest.timeMs >= target.timeMs && last)
    return { state: 'failure', timeMs: last.timeMs, price: last.close };
  return { state: 'pending' };
}

function forecast(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!a) return [];
  const radius = 2 + d.style.width / 2;
  if (!b) return [dot(a, radius, d.style.color)];
  const [from, to] = d.points,
    delta = to.price - from.price,
    ink = c.theme?.palette.background ?? '#0b0f14';
  const outcome = c.candles ? forecastOutcome(d.points, c.candles) : { state: 'pending' as const };
  const success = option<string>(d, 'successColor'),
    failure = option<string>(d, 'failureColor');
  const result: DrawingPrimitive[] = [
    ...line(a, b, c),
    dot(a, radius, d.style.color),
    dot(b, radius, d.style.color),
  ];
  if (outcome.state === 'success') {
    const hit = { x: g.x(outcome.timeMs!), y: b.y };
    result.push(path([hit, b], { color: success, width: 1, dash: [4, 4] }), dot(hit, radius, success));
  } else if (outcome.state === 'failure') {
    const actual = { x: b.x, y: g.y(outcome.price!) };
    if (finite(actual))
      result.push(
        path([b, actual], { color: failure, width: 1, dash: [4, 4] }),
        dot(actual, radius, failure),
      );
  }
  const size = d.style.fontSize,
    padding = c.theme?.chart.annotationPadding ?? 6,
    above = delta >= 0;
  // Baselines that put a box of `lines` rows 10px above or below a point.
  const over = (y: number, lines: number) => y - 10 - (lines - 1) * (size + 4) - 4 - padding / 2,
    under = (y: number) => y + 10 + size + padding / 2;
  // Labels sit on the far side of each anchor from the line, so the line stays readable.
  result.push(
    text({ x: a.x, y: above ? under(a.y) : over(a.y, 1) }, c.formatPrice(from.price), {
      align: 'center',
      background: d.style.color,
      color: ink,
      radius: 4,
      backgroundOpacity: 0.9,
    }),
  );
  const percent = signed((delta / from.price) * 100, v => v.toFixed(2));
  const lines = [
    `${c.formatPrice(to.price)}`,
    `${signed(delta, c.formatPrice)} (${percent}%)`,
    `${bars(c, from.timeMs, to.timeMs)} bars, ${duration(to.timeMs - from.timeMs)}`,
  ];
  const status = outcome.state === 'success' ? 'Success' : outcome.state === 'failure' ? 'Failure' : '';
  if (status) lines.unshift(status);
  result.push(
    text({ x: b.x, y: above ? over(b.y, lines.length) : under(b.y) }, lines.join('\n'), {
      align: 'center',
      background: status ? (status === 'Success' ? success : failure) : d.style.color,
      color: status ? '#ffffff' : ink,
      radius: 4,
      backgroundOpacity: 0.9,
      bold: !!status,
    }),
  );
  return result;
}

// Bars pattern

/**
 * Remembers the copied bars the first time the drawing is stored, so moving the copy later
 * keeps the original bars. Until then (a creation preview) the anchors are the source.
 */
function bindPatternSource(d: Drawing): void {
  const options = d.options ?? {};
  if (typeof options.sourceFrom === 'number' && typeof options.sourceTo === 'number') return;
  const [first, last] = d.points;
  d.options = { ...options, sourceFrom: first.timeMs, sourceTo: last.timeMs, sourcePrice: first.price };
}
function patternSource(d: Drawing) {
  const [first, last] = d.points;
  const read = (key: string, fallback: number) => {
    const value = d.options?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  return {
    from: read('sourceFrom', first.timeMs),
    to: read('sourceTo', last.timeMs),
    price: read('sourcePrice', first.price),
  };
}
type PatternMode = 'hl' | 'ohlc' | 'candles' | 'close' | 'open' | 'high' | 'low' | 'hl2';

function barsPattern(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!a) return [];
  if (!b || !c.candles?.length)
    return line({ x: a.x, y: g.top }, { x: a.x, y: g.top + g.plotHeight }, c, 0, 1, {
      dash: [4, 4],
      width: 1,
    });
  const source = patternSource(d),
    [first, last] = d.points;
  const low = Math.min(source.from, source.to),
    high = Math.max(source.from, source.to),
    half = c.intervalMs / 2;
  const start = lowerBound(c.candles, low - half),
    end = Math.min(lowerBound(c.candles, high + half), start + 5000);
  const span = source.to - source.from,
    stretch = span ? (last.timeMs - first.timeMs) / span : 1;
  const mirrored = option<boolean>(d, 'mirrored'),
    flipped = option<boolean>(d, 'flipped'),
    mode = option<PatternMode>(d, 'mode');
  const shift = first.price - source.price;
  const time = (t: number) => {
    const mapped = first.timeMs + (t - source.from) * stretch;
    return mirrored ? first.timeMs + last.timeMs - mapped : mapped;
  };
  const y = (price: number) => g.y(flipped ? 2 * first.price - (price + shift) : price + shift);
  const width = Math.max(1, Math.min(12, g.barSpacing * Math.abs(stretch) * 0.35));
  const result: DrawingPrimitive[] = [];
  const style = { width: Math.max(1, d.style.width / 2), opacity: 0.85 };
  if (['close', 'open', 'high', 'low', 'hl2'].includes(mode)) {
    const points: DrawingPoint[] = [];
    for (let i = start; i < end; i++) {
      const bar = c.candles[i];
      const value =
        mode === 'hl2' ? (bar.high + bar.low) / 2 : bar[mode as 'close' | 'open' | 'high' | 'low'];
      const p = { x: g.x(time(bar.timeMs)), y: y(value) };
      if (finite(p)) points.push(p);
    }
    if (points.length === 1) points.push({ x: points[0].x + 1, y: points[0].y });
    return points.length ? [path(points, { width: d.style.width, opacity: 0.85 })] : [];
  }
  for (let i = start; i < end; i++) {
    const bar = c.candles[i],
      x = g.x(time(bar.timeMs));
    const [open, close, top, bottom] = [y(bar.open), y(bar.close), y(bar.high), y(bar.low)];
    if (![x, open, close, top, bottom].every(Number.isFinite)) continue;
    result.push(
      path(
        [
          { x, y: top },
          { x, y: bottom },
        ],
        style,
      ),
    );
    if (mode === 'candles') {
      const body = [
        { x: x - width, y: open },
        { x: x + width, y: open },
        { x: x + width, y: close },
        { x: x - width, y: close },
      ];
      result.push(
        path(body, { ...style, closed: true, ...(bar.close < bar.open ? { fill: d.style.color } : {}) }),
      );
    } else if (mode === 'ohlc') {
      // Mirroring swaps which side reads as the open.
      const [left, right] = mirrored ? [close, open] : [open, close];
      result.push(
        path(
          [
            { x: x - width, y: left },
            { x, y: left },
          ],
          style,
        ),
        path(
          [
            { x, y: right },
            { x: x + width, y: right },
          ],
          style,
        ),
      );
    }
  }
  return result;
}

// Ghost feed

export interface GhostCandle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
/** A small deterministic generator, so ghost candles stay still across repaints. */
function random(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Average high-low range of up to `count` bars before `timeMs`, or of the first bars loaded. */
function averageRange(candles: readonly Candle[], timeMs: number, count: number): number {
  const end = Math.max(Math.min(count, candles.length), lowerBound(candles, timeMs)),
    start = Math.max(0, end - count);
  let sum = 0;
  for (let i = start; i < end; i++) sum += candles[i].high - candles[i].low;
  return end > start ? sum / (end - start) : 0;
}

/**
 * One candle per bar along each segment of clicks. Closes follow the segment with jitter
 * set by `variance` (0 to 1) of the average range, and each segment ends on its click.
 */
export function ghostCandles(
  points: readonly Anchor[],
  intervalMs: number,
  range: number,
  variance: number,
  seed: string,
  limit = 2000,
): GhostCandle[] {
  const next = random(seed),
    result: GhostCandle[] = [];
  for (let s = 1; s < points.length && result.length < limit; s++) {
    const from = points[s - 1],
      to = points[s];
    const count = Math.min(limit - result.length, Math.round((to.timeMs - from.timeMs) / intervalMs));
    let open = from.price;
    for (let k = 1; k <= count; k++) {
      const trend = from.price + ((to.price - from.price) * k) / count;
      const close = k === count ? to.price : trend + (next() - 0.5) * range * variance;
      const wick = range * (0.15 + next() * 0.35);
      result.push({
        timeMs: from.timeMs + k * intervalMs,
        open,
        close,
        high: Math.max(open, close) + wick * next(),
        low: Math.max(Number.MIN_VALUE, Math.min(open, close) - wick * next()),
      });
      open = close;
    }
  }
  return result;
}
const ghostStore = new WeakMap<readonly Candle[], Map<string, GhostCandle[]>>();
const NO_CANDLES: readonly Candle[] = [];

function ghostFeed(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const points = screen(d, c),
    g = c.geometry;
  if (!points[0]) return [];
  const average = Math.round(option<number>(d, 'averageBars')),
    variance = option<number>(d, 'variance') / 100;
  const candles = c.candles ?? NO_CANDLES;
  const key = `${d.id}|${c.intervalMs}|${average}|${variance}|${d.points.map(p => `${p.timeMs},${p.price}`).join(';')}`;
  const ghosts = memo(ghostStore, candles, key, () => {
    const range = averageRange(candles, d.points[0].timeMs, average) || d.points[0].price * 0.002;
    return ghostCandles(d.points, c.intervalMs, range, variance, d.id);
  });
  const up = option<string>(d, 'upColor'),
    down = option<string>(d, 'downColor'),
    opacity = option<number>(d, 'opacity'),
    width = Math.max(1, Math.min(10, g.barSpacing * 0.35));
  // A faint guide joins the clicks so the path stays visible and selectable between candles.
  const result: DrawingPrimitive[] = [path(points, { width: 1, dash: [3, 4], opacity: 0.5 })];
  for (const bar of ghosts) {
    const x = g.x(bar.timeMs);
    if (x < g.left - width || x > g.left + g.plotWidth + width) continue;
    const [open, close, top, bottom] = [g.y(bar.open), g.y(bar.close), g.y(bar.high), g.y(bar.low)];
    if (![x, open, close, top, bottom].every(Number.isFinite)) continue;
    const tint = bar.close >= bar.open ? up : down,
      body = Math.abs(close - open) < 1 ? { a: open - 0.5, b: open + 0.5 } : { a: open, b: close };
    result.push(
      path(
        [
          { x, y: top },
          { x, y: bottom },
        ],
        { color: tint, width: 1, opacity },
      ),
      path(
        [
          { x: x - width, y: body.a },
          { x: x + width, y: body.a },
          { x: x + width, y: body.b },
          { x: x - width, y: body.b },
        ],
        { closed: true, fill: tint, color: tint, width: 1, opacity },
      ),
    );
  }
  return result;
}

// Projection

function projection(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [origin, b, third] = screen(d, c);
  if (!b) return [];
  if (!third) return line(origin, b, c);
  const radius = Math.hypot(b.x - origin.x, b.y - origin.y);
  if (!radius) return [];
  const start = Math.atan2(b.y - origin.y, b.x - origin.x);
  let sweep = Math.atan2(third.y - origin.y, third.x - origin.x) - start;
  if (third.x === origin.x && third.y === origin.y) sweep = 0;
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  if (sweep < -Math.PI) sweep += Math.PI * 2;
  const at = (angle: number) => ({
    x: origin.x + radius * Math.cos(angle),
    y: origin.y + radius * Math.sin(angle),
  });
  const arc = (from: number, to: number) => {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (Math.PI / 90)));
    return Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps));
  };
  const end = at(start + sweep),
    result: DrawingPrimitive[] = [];
  if (option(d, 'background') && sweep) {
    // Two tones meet halfway through the sweep.
    const middle = start + sweep / 2;
    result.push(
      fill([origin, ...arc(start, middle)], option<string>(d, 'color1')),
      fill([origin, ...arc(middle, start + sweep)], option<string>(d, 'color2')),
    );
  }
  result.push(path([origin, b]), path([origin, end]), path(arc(start, start + sweep)));
  if (option(d, 'trendLine')) result.push(path([b, origin, third], { width: 1, dash: [4, 4], opacity: 0.7 }));
  const price = c.geometry.price(end.y);
  if (Number.isFinite(price))
    result.push(
      text({ x: end.x + 6, y: end.y }, `1 (${c.formatPrice(price)})`, { plain: true, middle: true }),
    );
  return result;
}

// Anchored VWAP

type VwapSource = 'hlc3' | 'hl2' | 'ohlc4' | 'close' | 'open' | 'high' | 'low';
const sourcePrice = (bar: Candle, source: VwapSource): number =>
  source === 'hlc3'
    ? (bar.high + bar.low + bar.close) / 3
    : source === 'hl2'
      ? (bar.high + bar.low) / 2
      : source === 'ohlc4'
        ? (bar.open + bar.high + bar.low + bar.close) / 4
        : bar[source];

export interface VwapSeries {
  /** Index of the anchor bar in the candle array. */
  start: number;
  /** VWAP and volume-weighted standard deviation for bars `start..`, one entry each. */
  vwap: Float64Array;
  deviation: Float64Array;
}
/** VWAP from the bar that contains `anchorMs` through the last loaded bar. */
export function anchoredVwap(
  candles: readonly Candle[],
  anchorMs: number,
  intervalMs: number,
  source: VwapSource = 'hlc3',
): VwapSeries {
  const start = lowerBound(candles, anchorMs - intervalMs / 2),
    count = Math.max(0, candles.length - start);
  const vwap = new Float64Array(count),
    deviation = new Float64Array(count);
  // Weighted Welford update: stable for large prices where sum(p²v) would lose precision.
  let weight = 0,
    mean = 0,
    spread = 0;
  for (let i = 0; i < count; i++) {
    const bar = candles[start + i],
      price = sourcePrice(bar, source);
    // Bars without volume still count a little, so feeds without volume get an average.
    const w = bar.volume > 0 ? bar.volume : 1e-9;
    weight += w;
    const delta = price - mean;
    mean += (delta * w) / weight;
    spread += w * delta * (price - mean);
    vwap[i] = mean;
    deviation[i] = Math.sqrt(Math.max(0, spread / weight));
  }
  return { start, vwap, deviation };
}
const vwapStore = new WeakMap<readonly Candle[], Map<string, VwapSeries>>();
function vwapSeries(d: Drawing, c: DrawingContext): VwapSeries | null {
  if (!c.candles?.length) return null;
  const source = option<VwapSource>(d, 'source'),
    anchor = d.points[0].timeMs;
  const series = memo(vwapStore, c.candles, `${anchor}|${c.intervalMs}|${source}`, () =>
    anchoredVwap(c.candles!, anchor, c.intervalMs, source),
  );
  return series.vwap.length ? series : null;
}

function vwapTool(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a] = screen(d, c),
    g = c.geometry;
  if (!a) return [];
  const series = vwapSeries(d, c);
  if (!series) return [dot(a, 3, d.style.color)];
  const candles = c.candles!,
    from = Math.max(series.start, lowerBound(candles, g.fromMs - c.intervalMs) - 1),
    to = Math.min(candles.length, lowerBound(candles, g.toMs + c.intervalMs) + 1);
  if (from >= to) return [];
  const curve = (k: number) => {
    const points: DrawingPoint[] = [];
    for (let i = from; i < to; i++) {
      const j = i - series.start,
        p = { x: g.x(candles[i].timeMs), y: g.y(series.vwap[j] + k * series.deviation[j]) };
      if (finite(p)) points.push(p);
    }
    if (points.length === 1) points.push({ x: points[0].x + 1, y: points[0].y });
    return points;
  };
  const result: DrawingPrimitive[] = [];
  const band = option<string>(d, 'bandColor');
  for (const n of [3, 2, 1]) {
    if (!option(d, `band${n}`)) continue;
    const k = option<number>(d, `multiplier${n}`),
      upper = curve(k),
      lower = curve(-k);
    if (option(d, 'bandFill') && upper.length && lower.length)
      result.push(fill([...upper, ...[...lower].reverse()], band));
    result.push(path(upper, { color: band, width: 1 }), path(lower, { color: band, width: 1 }));
  }
  result.push(path(curve(0)));
  result.push(axisTag('price', series.vwap.at(-1)!, { color: d.style.color }));
  return result;
}
/** The handle sits on the line's first value, so dragging it moves the anchor bar. */
function vwapHandles(d: Drawing, c: DrawingContext): DrawingHandle[] {
  const series = vwapSeries(d, c),
    g = c.geometry;
  const at = series
    ? { x: g.x(c.candles![series.start].timeMs), y: g.y(series.vwap[0]) }
    : { x: g.x(d.points[0].timeMs), y: g.y(d.points[0].price) };
  return [{ id: 'anchor', at, cursor: 'move' }];
}
/** Snaps an anchor to the bar under it, at that bar's source price. */
function vwapAnchor(anchor: Anchor, source: VwapSource, c: DrawingContext): Anchor[] {
  const candles = c.candles;
  if (!candles?.length) return [anchor];
  const bar = candles[Math.min(candles.length - 1, lowerBound(candles, anchor.timeMs - c.intervalMs / 2))];
  if (Math.abs(bar.timeMs - anchor.timeMs) > c.intervalMs) return [anchor];
  return [{ timeMs: bar.timeMs, price: sourcePrice(bar, source) }];
}

// Fixed range volume profile

const profileStore = new WeakMap<readonly Candle[], Map<string, PriceProfile>>();

/** The profile of the bars between both anchors, or null before there are any. */
function rangeProfile(d: Drawing, c: DrawingContext): PriceProfile | null {
  const candles = c.candles;
  if (!candles?.length || d.points.length < 2) return null;
  const low = Math.min(d.points[0].timeMs, d.points[1].timeMs),
    high = Math.max(d.points[0].timeMs, d.points[1].timeMs);
  const start = lowerBound(candles, low - c.intervalMs / 2),
    end = lowerBound(candles, high + c.intervalMs / 2);
  if (start >= end) return null;
  const layout = option<string>(d, 'rowsLayout'),
    size = option<number>(d, 'rowSize'),
    share = option<number>(d, 'valueArea') / 100;
  const key = `${start}|${end}|${layout}|${size}|${share}|${c.tickSize ?? ''}`;
  const profile = memo(profileStore, candles, key, () => {
    let top = -Infinity,
      bottom = Infinity;
    for (let i = start; i < end; i++) {
      top = Math.max(top, candles[i].high);
      bottom = Math.min(bottom, candles[i].low);
    }
    let step =
      layout === 'ticks' && c.tickSize ? c.tickSize * size : Math.max(top - bottom, top * 1e-6) / size;
    // A tiny tick size on a wide range would make thousands of rows.
    while ((top - bottom) / step > 500) step *= 2;
    return buildProfile(candles, start, end, step, share);
  });
  return profile.poc < 0 ? null : profile;
}

function volumeProfile(d: Drawing, c: DrawingContext): DrawingPrimitive[] {
  const [a, b] = screen(d, c),
    g = c.geometry;
  if (!a) return [];
  const edge = (x: number) =>
    line({ x, y: g.top }, { x, y: g.top + g.plotHeight }, c, 0, 1, { width: 1, dash: [4, 4], opacity: 0.6 });
  if (!b) return edge(a.x);
  const x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x),
    profile = rangeProfile(d, c);
  if (!profile) return [...edge(x0), ...edge(x1)];
  const right = option<string>(d, 'placement') === 'right',
    width = ((x1 - x0) * option<number>(d, 'width')) / 100,
    split = option<string>(d, 'volume') === 'updown';
  const up = option<string>(d, 'upColor'),
    down = option<string>(d, 'downColor');
  const yTop = g.y(profile.rows.at(-1)!.high),
    yBottom = g.y(profile.rows[0].low);
  const result: DrawingPrimitive[] = [
    fill(
      [
        { x: x0, y: yTop },
        { x: x1, y: yTop },
        { x: x1, y: yBottom },
        { x: x0, y: yBottom },
      ],
      d.style.color,
      d.style.fillOpacity / 2,
    ),
  ];
  const bar = (from: number, length: number, y1: number, y2: number, tint: string, opacity: number) => {
    const [p, q] = right ? [x1 - from - length, x1 - from] : [x0 + from, x0 + from + length];
    result.push(
      fill(
        [
          { x: p, y: y1 },
          { x: q, y: y1 },
          { x: q, y: y2 },
          { x: p, y: y2 },
        ],
        tint,
        opacity,
      ),
    );
  };
  profile.rows.forEach((row, i) => {
    const volume = row.buy + row.sell;
    if (!(volume > 0)) return;
    const inside = !!profile.valueArea && i >= profile.valueArea.low && i <= profile.valueArea.high,
      opacity = inside ? 0.7 : 0.3;
    let y1 = g.y(row.high),
      y2 = g.y(row.low);
    // A hairline gap separates rows once they are tall enough to show it.
    if (Math.abs(y2 - y1) > 3) y1 += Math.sign(y2 - y1);
    const length = (width * volume) / profile.maxVolume;
    if (split) {
      const buy = (length * row.buy) / volume;
      bar(0, buy, y1, y2, up, opacity);
      bar(buy, length - buy, y1, y2, down, opacity);
    } else bar(0, length, y1, y2, up, opacity);
  });
  if (option(d, 'showPoc')) {
    const row = profile.rows[profile.poc],
      y = g.y((row.low + row.high) / 2);
    result.push(
      path(
        [
          { x: x0, y },
          { x: x1, y },
        ],
        { color: option<string>(d, 'pocColor'), width: 1, opacity: 1 },
      ),
    );
  }
  return result;
}

/**
 * Edge handles for tools whose anchors only mark time: both sit at `y`, the start one moves
 * freely and the end one only changes time.
 */
function edgeHandles(d: Drawing, c: DrawingContext, y: number, startCursor: DrawingHandle['cursor']) {
  const g = c.geometry;
  return [
    { id: 'start', at: { x: g.x(d.points[0].timeMs), y }, cursor: startCursor },
    { id: 'end', at: { x: g.x(d.points[1].timeMs), y }, cursor: 'ew-resize' as const },
  ];
}
function moveEdge(d: Drawing, handle: string, anchor: Anchor, keepPrice: boolean): Anchor[] {
  const [first, last] = d.points;
  return handle === 'start'
    ? [keepPrice ? { timeMs: anchor.timeMs, price: first.price } : anchor, last]
    : [first, { timeMs: anchor.timeMs, price: last.price }];
}

/** Projection tools after the position plans. */
export const projectionTools: readonly DrawingToolDefinition[] = [
  tool('forecast', 'Forecast', 'Projection', 2, forecast, {
    hint: 'Click the source bar, then the target.',
    settings: [
      color('successColor', 'Success', '#089981', 'Outcome'),
      color('failureColor', 'Failure', '#f23645', 'Outcome'),
    ],
  }),
  tool('bars-pattern', 'Bars pattern', 'Projection', 2, barsPattern, {
    hint: 'Click the first and last bar to copy, then drag the copy.',
    validate: bindPatternSource,
    // The second anchor's price means nothing, so its handle stays level with the first.
    handles: (d, c) => edgeHandles(d, c, c.geometry.y(d.points[0].price), 'move'),
    moveHandle: (d, handle, anchor) => moveEdge(d, handle, anchor, false),
    settings: [
      choice(
        'mode',
        'Mode',
        'hl',
        [
          ['hl', 'HL bars'],
          ['ohlc', 'OHLC bars'],
          ['candles', 'Candles'],
          ['close', 'Line - close'],
          ['open', 'Line - open'],
          ['high', 'Line - high'],
          ['low', 'Line - low'],
          ['hl2', 'Line - HL/2'],
        ],
        'Style',
      ),
      toggle('mirrored', 'Mirrored', false, 'Style'),
      toggle('flipped', 'Flipped', false, 'Style'),
    ],
  }),
  tool('ghost-feed', 'Ghost feed', 'Projection', 'path', ghostFeed, {
    settings: [
      color('upColor', 'Up', '#089981', 'Candles'),
      color('downColor', 'Down', '#f23645', 'Candles'),
      number('opacity', 'Opacity', 0.5, 0.1, 1, 0.05, 'Candles'),
      number('averageBars', 'Average HL in bars', 20, 1, 500, 1, 'Generation'),
      number('variance', 'Variance %', 50, 0, 100, 1, 'Generation'),
    ],
  }),
  tool('projection', 'Projection', 'Projection', 3, projection, {
    hint: 'Click the origin, then the radius, then where the arc ends.',
    settings: [
      toggle('background', 'Background', true, 'Style'),
      color('color1', 'Colour 1', '#2962ff', 'Style'),
      color('color2', 'Colour 2', '#9c27b0', 'Style'),
      toggle('trendLine', 'Trend line', true, 'Style'),
    ],
  }),
];

/** Volume-based. */
export const volumeTools: readonly DrawingToolDefinition[] = [
  tool('anchored-vwap', 'Anchored VWAP', 'Volume-based', 1, vwapTool, {
    hint: 'Click the bar to start VWAP from.',
    create: (anchor, context) => vwapAnchor(anchor, 'hlc3', context),
    handles: vwapHandles,
    moveHandle: (d, _handle, anchor, context) => vwapAnchor(anchor, option<VwapSource>(d, 'source'), context),
    settings: [
      choice(
        'source',
        'Source',
        'hlc3',
        [
          ['hlc3', 'HLC/3'],
          ['hl2', 'HL/2'],
          ['ohlc4', 'OHLC/4'],
          ['close', 'Close'],
          ['open', 'Open'],
          ['high', 'High'],
          ['low', 'Low'],
        ],
        'Inputs',
      ),
      toggle('band1', 'Band 1', false, 'Bands'),
      number('multiplier1', 'Multiplier 1', 1, 0.1, 10, 0.1, 'Bands'),
      toggle('band2', 'Band 2', false, 'Bands'),
      number('multiplier2', 'Multiplier 2', 2, 0.1, 10, 0.1, 'Bands'),
      toggle('band3', 'Band 3', false, 'Bands'),
      number('multiplier3', 'Multiplier 3', 3, 0.1, 10, 0.1, 'Bands'),
      color('bandColor', 'Band colour', '#4caf50', 'Bands'),
      toggle('bandFill', 'Fill bands', true, 'Bands'),
    ],
  }),
  tool('fixed-range-volume-profile', 'Fixed range volume profile', 'Volume-based', 2, volumeProfile, {
    hint: 'Click the first and last bar of the range.',
    handles: (d, c) => {
      const profile = rangeProfile(d, c),
        g = c.geometry;
      const y = profile ? g.y((profile.rows[0].low + profile.rows.at(-1)!.high) / 2) : g.y(d.points[0].price);
      return edgeHandles(d, c, y, 'ew-resize');
    },
    moveHandle: (d, handle, anchor) => moveEdge(d, handle, anchor, true),
    settings: [
      choice(
        'rowsLayout',
        'Rows layout',
        'rows',
        [
          ['rows', 'Number of rows'],
          ['ticks', 'Ticks per row'],
        ],
        'Inputs',
      ),
      number('rowSize', 'Row size', 24, 1, 1000, 1, 'Inputs'),
      number('valueArea', 'Value area %', 70, 1, 100, 1, 'Inputs'),
      choice(
        'volume',
        'Volume',
        'updown',
        [
          ['updown', 'Up/Down'],
          ['total', 'Total'],
        ],
        'Inputs',
      ),
      choice(
        'placement',
        'Placement',
        'left',
        [
          ['left', 'Left'],
          ['right', 'Right'],
        ],
        'Style',
      ),
      number('width', 'Width % of range', 30, 5, 100, 1, 'Style'),
      color('upColor', 'Up volume', '#2962ff', 'Style'),
      color('downColor', 'Down volume', '#fbc02d', 'Style'),
      toggle('showPoc', 'POC', true, 'Style'),
      color('pocColor', 'POC colour', '#ff0000', 'Style'),
    ],
  }),
];

/** 24-unit SVG paths keyed by tool type. */
export const forecastIcons: Readonly<Record<string, string>> = {
  forecast:
    '<path d="m5 18 11-9"/><circle cx="4" cy="19" r="1.5"/><circle cx="17" cy="8" r="1.5"/><rect x="14" y="2" width="7" height="3.5" rx="1"/><path d="M17 8v12" stroke-dasharray="2 2"/>',
  'bars-pattern':
    '<path d="M5 5v10M3.5 8H5m0 4h1.5M10 3v9M8.5 5H10m0 5h1.5"/><path d="M15 12v9m-1.5-6H15m0 4h1.5M20 10v8m-1.5-6H20m0 4h1.5" stroke-dasharray="2 1.5"/>',
  'ghost-feed':
    '<rect x="3" y="11" width="4" height="6" rx=".5"/><path d="M5 8v3m0 6v3"/><rect x="10" y="7" width="4" height="6" rx=".5" stroke-dasharray="2 1.5"/><path d="M12 4v3m0 6v3"/><rect x="17" y="5" width="4" height="5" rx=".5" stroke-dasharray="2 1.5"/><path d="M19 2v3m0 5v3"/>',
  projection: '<path d="M4 20 13 3M4 20l17-8"/><path d="M13 3a19 19 0 0 1 8 9"/>',
  'anchored-vwap':
    '<path d="M5 17c3-1 4-7 8-7s5 3 8 1"/><circle cx="5" cy="17" r="2"/><path d="M5 4v9M5 21v-2" stroke-dasharray="2 2"/>',
  'fixed-range-volume-profile':
    '<path d="M4 3v18M20 3v18M4 6h6M4 10h10M4 14h7M4 18h4"/><path d="M4 10h16" stroke-dasharray="2 2"/>',
};
