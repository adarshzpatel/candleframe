import type { ChartGeometry } from './geometry.ts';
import { buildProfile, currentSession, profileStep, sessionRanges } from './profiles.ts';
import type { PriceProfile } from './profiles.ts';
import { themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { Candle, IndicatorPlugin, ProfileOptions, RuntimeState } from './types.ts';

/** Reuses each profile until its bars or row size change. Keys are per column and session. */
export type ProfileCache = Map<
  string,
  { candles: readonly Candle[]; start: number; end: number; step: number; profile: PriceProfile }
>;
/** Day ranges, recomputed when bars are added or the time zone changes. */
type SessionCache = { key: string; ranges: { start: number; end: number }[] };
const sessionCaches = new WeakMap<ProfileCache, SessionCache>();

const GAP = 6;
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

type ProfileItem = RuntimeState['indicators'][number] & {
  plugin: IndicatorPlugin & { profile: ProfileOptions };
};

/**
 * Draws visible profile indicators. Session profiles sit over their own bars; the volume
 * and delta columns sit against the price axis, right to left in pane order.
 */
export function renderProfiles(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  cache: ProfileCache,
  timeZone = 'UTC',
): void {
  if (!state.document.layers.indicator || !state.candles.length) return;
  const profiles = state.indicators.filter(
    (item): item is ProfileItem => item.visible && item.plugin.pane === 'profile' && !!item.plugin.profile,
  );
  if (!profiles.length) return;
  const candles = state.candles;
  const { start, end } = visibleRange(candles, g.fromMs, g.toMs, state.feed.intervalMs);
  if (end <= start) return;
  const top = g.top,
    bottom = g.top + g.plotHeight;
  const pricePerPixel = Math.abs(g.price(top + g.plotHeight / 2) - g.price(top + g.plotHeight / 2 + 1));
  const stepFor = (options: ProfileOptions) =>
    Math.max(state.feed.instrument.tickSize, profileStep(options.rowHeight * pricePerPixel));
  // Earlier days never change, so only the newest session rebuilds as bars stream in.
  const profileFor = (key: string, from: number, to: number, step: number, valueArea: number) => {
    const cached = cache.get(key);
    const fresh =
      cached &&
      cached.step === step &&
      cached.start === from &&
      cached.end === to &&
      (cached.candles === candles || to < candles.length);
    const profile = fresh ? cached.profile : buildProfile(candles, from, to, step, valueArea);
    cache.set(key, { candles, start: from, end: to, step, profile });
    return profile;
  };
  const sessions = (count: number) => {
    const key = `${timeZone}|${count}|${candles.length}|${candles[0].timeMs}|${candles.at(-1)!.timeMs}`;
    let entry = sessionCaches.get(cache);
    if (entry?.key !== key)
      sessionCaches.set(cache, (entry = { key, ranges: sessionRanges(candles, count, timeZone) }));
    return entry.ranges;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, top, g.plotWidth, g.plotHeight);
  ctx.clip();
  for (const { plugin } of profiles) {
    const options = plugin.profile;
    // Today and the current session are one profile alone, over their own bars.
    const single = options.range === 'today' || options.range === 'session';
    const ranges =
      options.range === 'session'
        ? [currentSession(candles, state.feed.intervalMs)!]
        : sessions(single ? 1 : (options.sessions ?? 0));
    const step = stepFor(options);
    ranges.forEach(({ start: from, end: to }) => {
      const x0 = g.x(candles[from].timeMs),
        x1 = g.x(candles[to - 1].timeMs + state.feed.intervalMs);
      if (x1 < g.left || x0 > g.left + g.plotWidth || x1 - x0 < 8) return;
      const key = `${plugin.id}|session|${candles[from].timeMs}`;
      const profile = profileFor(key, from, to, step, options.valueArea ?? 0.7);
      if (profile.poc >= 0) drawSession(ctx, profile, g, theme, x0, x1, top, bottom, options.delta, single);
    });
  }
  // Delta hugs the price axis and volume sits beside it: one order-flow sidebar.
  let right = g.left + g.plotWidth;
  for (const { plugin } of profiles) {
    const options = plugin.profile;
    if (options.range === 'today' || options.range === 'session') continue;
    const profile = profileFor(
      `${plugin.id}|visible`,
      start,
      end,
      stepFor(options),
      options.valueArea ?? 0.7,
    );
    if (profile.poc < 0) continue;
    const columns = [
      ...(options.delta
        ? [{ mode: 'delta' as const, share: options.volume ? options.width / 2 : options.width, min: 40 }]
        : []),
      ...(options.volume ? [{ mode: 'volume' as const, share: options.width, min: 48 }] : []),
    ];
    for (const column of columns) {
      const left = right - Math.max(column.min, g.plotWidth * column.share);
      if (left < g.left) break;
      if (column.mode === 'volume') drawVolume(ctx, profile, g, theme, left, right, top, bottom);
      else drawDelta(ctx, profile, g, theme, left, right, top, bottom);
      right = left - GAP;
    }
  }
  ctx.restore();
}

/**
 * One day's profile over its own bars, growing right from the day's first bar. With delta,
 * each row splits into buy and sell. POC, VAH and VAL run across the day; `labeled` names them.
 */
function drawSession(
  ctx: CanvasRenderingContext2D,
  profile: PriceProfile,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  delta: boolean,
  labeled: boolean,
): void {
  const width = (x1 - x0) * 0.7;
  const area = profile.valueArea!;
  // A faint rule marks where each day starts.
  ctx.fillStyle = themeColorCSS(theme, '@text', 0.12);
  ctx.fillRect(Math.round(x0), top, 1, bottom - top);
  profile.rows.forEach((row, i) => {
    const volume = row.buy + row.sell;
    if (volume <= 0) return;
    const { y, h } = rowBar(g, row.low, row.high);
    if (y > bottom || y + h < top) return;
    const inside = i >= area.low && i <= area.high;
    const length = (width * volume) / profile.maxVolume;
    if (!delta) {
      ctx.fillStyle =
        i === profile.poc
          ? themeColorCSS(theme, '@accent', 0.6)
          : themeColorCSS(theme, '@text', inside ? 0.22 : 0.1);
      capsule(ctx, x0, y, length, h, 'right');
      return;
    }
    const alpha = inside ? 0.42 : 0.2;
    const buy = (length * row.buy) / volume;
    ctx.fillStyle = themeColorCSS(theme, '@positive', alpha);
    ctx.fillRect(x0, y, buy, h);
    ctx.fillStyle = themeColorCSS(theme, '@negative', alpha);
    capsule(ctx, x0 + buy, y, length - buy, h, 'right');
  });
  levels(ctx, profile, g, theme, x0, x1, top, bottom, labeled);
  if (!delta) return;
  // Net delta under the day's lowest row, when there is room.
  const net = profile.buy - profile.sell;
  const size = theme.typography.axisSize;
  const y = g.y(profile.rows[0].low) + size * 1.2;
  ctx.font = `${size}px ${theme.typography.numberFamily}`;
  const text = `Δ ${compact.format(net)}`;
  if (y < bottom - 2 && ctx.measureText(text).width < x1 - x0 - 4) {
    ctx.textAlign = 'left';
    ctx.fillStyle = themeColorCSS(theme, net >= 0 ? '@positive' : '@negative', 0.9);
    ctx.fillText(text, x0 + 3, y);
  }
}

/**
 * Point of control as a solid line, value area high and low as dotted lines, from `x0` to
 * `x1`. With `labeled`, each is named at its right end.
 */
function levels(
  ctx: CanvasRenderingContext2D,
  profile: PriceProfile,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  x0: number,
  x1: number,
  top: number,
  bottom: number,
  labeled: boolean,
): void {
  const area = profile.valueArea!;
  const poc = profile.rows[profile.poc];
  const size = theme.typography.axisSize;
  ctx.font = `${size}px ${theme.typography.numberFamily}`;
  ctx.textAlign = 'right';
  for (const level of [
    { name: 'VAH', y: g.y(profile.rows[area.high].high), dash: [2, 3], width: 1, alpha: 0.75 },
    { name: 'POC', y: (g.y(poc.low) + g.y(poc.high)) / 2, dash: [], width: 1.5, alpha: 1 },
    { name: 'VAL', y: g.y(profile.rows[area.low].low), dash: [2, 3], width: 1, alpha: 0.75 },
  ]) {
    if (level.y < top || level.y > bottom) continue;
    const y = Math.round(level.y) + (level.width === 1 ? 0.5 : 0);
    ctx.strokeStyle = themeColorCSS(theme, '@accent', level.alpha);
    ctx.lineWidth = level.width;
    ctx.setLineDash(level.dash);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    if (labeled && x1 - x0 > 40 && y > top + size) {
      ctx.fillStyle = themeColorCSS(theme, '@accent', level.alpha);
      ctx.fillText(level.name, x1 - 2, y - 3);
    }
  }
  ctx.setLineDash([]);
}

interface Bar {
  y: number;
  h: number;
}
/** Row edges in pixels with a hairline gap once rows are tall enough to separate. */
function rowBar(g: ChartGeometry, low: number, high: number): Bar {
  const y0 = g.y(high),
    y1 = g.y(low);
  const h = y1 - y0;
  const gap = h >= 5 ? 1 : h >= 3 ? 0.5 : 0;
  return { y: y0 + gap / 2, h: Math.max(0.5, h - gap) };
}
/** A bar rounded only at its free end, so stacks read as one shape. */
function capsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  end: 'left' | 'right',
): void {
  if (w <= 0) return;
  const r = Math.min(2, h / 2, w);
  ctx.beginPath();
  if (r >= 0.75 && typeof ctx.roundRect === 'function')
    ctx.roundRect(x, y, w, h, end === 'left' ? [r, 0, 0, r] : [0, r, r, 0]);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}
/** A fill that fades toward the column's open side, so dense profiles stay airy. */
function fade(
  ctx: CanvasRenderingContext2D,
  theme: ResolvedChartTheme,
  token: string,
  alpha: number,
  from: number,
  to: number,
): string | CanvasGradient {
  if (typeof ctx.createLinearGradient !== 'function') return themeColorCSS(theme, token, alpha);
  const gradient = ctx.createLinearGradient(from, 0, to, 0);
  gradient.addColorStop(0, themeColorCSS(theme, token, alpha * 0.5));
  gradient.addColorStop(1, themeColorCSS(theme, token, alpha));
  return gradient;
}

function caption(
  ctx: CanvasRenderingContext2D,
  theme: ResolvedChartTheme,
  bottom: number,
  left: number,
  right: number,
  parts: readonly { text: string; color: string }[],
): void {
  const size = theme.typography.axisSize;
  // Sits above the watermark, which owns the plot's bottom-right corner.
  const y = bottom - theme.chart.axisLabelPadding - theme.typography.watermarkSize - size * 0.9;
  ctx.font = `${size}px ${theme.typography.numberFamily}`;
  ctx.textAlign = 'right';
  // Narrow columns drop the leading name first, then the whole caption.
  const fitting = [...parts];
  const span = () =>
    fitting.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0) +
    (fitting.length - 1) * size * 0.6;
  while (fitting.length && span() > right - left - 6) fitting.shift();
  let x = right - 4;
  for (const part of fitting.reverse()) {
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, x, y);
    x -= ctx.measureText(part.text).width + size * 0.6;
  }
}

function drawVolume(
  ctx: CanvasRenderingContext2D,
  profile: PriceProfile,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  const width = right - left;
  const area = profile.valueArea!;
  // One calm tone: the value area brighter, the tails quieter, the POC in the accent.
  // Buy and sell balance is the delta profile's job.
  const fills = {
    in: fade(ctx, theme, '@text', 0.3, left, right),
    out: fade(ctx, theme, '@text', 0.12, left, right),
    poc: fade(ctx, theme, '@accent', 0.85, left, right),
  };
  profile.rows.forEach((row, i) => {
    const volume = row.buy + row.sell;
    if (volume <= 0) return;
    const { y, h } = rowBar(g, row.low, row.high);
    if (y > bottom || y + h < top) return;
    ctx.fillStyle = i === profile.poc ? fills.poc : i >= area.low && i <= area.high ? fills.in : fills.out;
    capsule(
      ctx,
      right - (width * volume) / profile.maxVolume,
      y,
      (width * volume) / profile.maxVolume,
      h,
      'left',
    );
  });
  // Value area: a bracket along the axis edge.
  const vaTop = g.y(profile.rows[area.high].high),
    vaBottom = g.y(profile.rows[area.low].low);
  ctx.fillStyle = themeColorCSS(theme, '@accent', 0.5);
  ctx.fillRect(right - 1.5, vaTop, 1.5, vaBottom - vaTop);
  // POC, VAH and VAL across the plot, up to the column.
  levels(ctx, profile, g, theme, g.left, left - 4, top, bottom, true);
  const share = Math.round(
    (profile.rows.slice(area.low, area.high + 1).reduce((sum, row) => sum + row.buy + row.sell, 0) /
      (profile.buy + profile.sell)) *
      100,
  );
  caption(ctx, theme, bottom, left, right, [
    { text: 'VOL PROFILE', color: theme.palette.textFaint },
    { text: `VA ${share}%`, color: themeColorCSS(theme, '@accent', 0.8) },
  ]);
}

function drawDelta(
  ctx: CanvasRenderingContext2D,
  profile: PriceProfile,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  // Every row grows from the axis edge, like the volume profile; color carries the sign.
  const width = right - left;
  let most = -1,
    least = -1;
  profile.rows.forEach((row, i) => {
    const delta = row.buy - row.sell;
    if (!delta) return;
    const { y, h } = rowBar(g, row.low, row.high);
    if (y > bottom || y + h < top) return;
    const strength = Math.abs(delta) / profile.maxDelta;
    // Opacity follows magnitude, so the heaviest imbalances read first.
    ctx.fillStyle = themeColorCSS(
      theme,
      delta > 0 ? '@positive' : '@negative',
      0.18 + 0.72 * strength ** 0.75,
    );
    const length = Math.max(1, width * strength);
    capsule(ctx, right - length, y, length, h, 'left');
    if (delta > 0 && (most < 0 || delta > profile.rows[most].buy - profile.rows[most].sell)) most = i;
    if (delta < 0 && (least < 0 || delta < profile.rows[least].buy - profile.rows[least].sell)) least = i;
  });
  const size = theme.typography.axisSize;
  ctx.font = `${size}px ${theme.typography.numberFamily}`;
  // Label the strongest buying and selling rows just past their tips.
  for (const i of [most, least]) {
    if (i < 0) continue;
    const row = profile.rows[i];
    const delta = row.buy - row.sell;
    const y = (g.y(row.low) + g.y(row.high)) / 2 + size * 0.35;
    if (y < top + size || y > bottom - size) continue;
    const text = compact.format(delta);
    const tip = right - width * (Math.abs(delta) / profile.maxDelta);
    const textWidth = ctx.measureText(text).width;
    if (tip - 4 - textWidth >= left) {
      ctx.textAlign = 'right';
      ctx.fillStyle = themeColorCSS(theme, delta > 0 ? '@positive' : '@negative', 1);
      ctx.fillText(text, tip - 4, y);
    } else if (tip + 4 + textWidth <= right - 2) {
      // A bar too long to label past its tip carries the label inside, never in the next column.
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.palette.textStrong;
      ctx.fillText(text, tip + 4, y);
    }
  }
  const net = profile.buy - profile.sell;
  caption(ctx, theme, bottom, left, right, [
    { text: 'DELTA', color: theme.palette.textFaint },
    {
      text: compact.format(net),
      color: themeColorCSS(theme, net >= 0 ? '@positive' : '@negative', 0.95),
    },
  ]);
}
