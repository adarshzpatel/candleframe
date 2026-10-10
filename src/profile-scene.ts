import type { ChartGeometry } from './geometry.ts';
import { buildProfile, profileStep } from './profiles.ts';
import type { PriceProfile } from './profiles.ts';
import { themeColorCSS } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import { visibleRange } from './time-scale.ts';
import type { Candle, IndicatorPlugin, ProfileOptions, RuntimeState } from './types.ts';

/** Reuses each profile until the bars, visible range or row size change. */
export type ProfileCache = Map<
  string,
  { candles: readonly Candle[]; start: number; end: number; step: number; profile: PriceProfile }
>;

const GAP = 6;
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/**
 * Draws visible profile indicators against the price axis, right to left in pane order.
 * Rows are aggregated from the visible bars and clipped to the price area.
 */
export function renderProfiles(
  ctx: CanvasRenderingContext2D,
  state: RuntimeState,
  g: ChartGeometry,
  theme: ResolvedChartTheme,
  cache: ProfileCache,
): void {
  if (!state.document.layers.indicator || !state.candles.length) return;
  const profiles = state.indicators.filter(
    (item): item is typeof item & { plugin: IndicatorPlugin & { profile: ProfileOptions } } =>
      item.visible && item.plugin.pane === 'profile' && !!item.plugin.profile,
  );
  if (!profiles.length) return;
  // Delta hugs the price axis and volume sits beside it: one order-flow sidebar.
  profiles.sort(
    (a, b) => (a.plugin.profile.mode === 'delta' ? 0 : 1) - (b.plugin.profile.mode === 'delta' ? 0 : 1),
  );
  const { start, end } = visibleRange(state.candles, g.fromMs, g.toMs, state.feed.intervalMs);
  if (end <= start) return;
  const top = g.top,
    bottom = g.top + g.plotHeight;
  const pricePerPixel = Math.abs(g.price(top + g.plotHeight / 2) - g.price(top + g.plotHeight / 2 + 1));
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, top, g.plotWidth, g.plotHeight);
  ctx.clip();
  let right = g.left + g.plotWidth;
  for (const { plugin } of profiles) {
    const options = plugin.profile;
    const width = Math.max(options.mode === 'delta' ? 40 : 48, g.plotWidth * options.width);
    const left = right - width;
    if (left < g.left) break;
    const step = Math.max(state.feed.instrument.tickSize, profileStep(options.rowHeight * pricePerPixel));
    const cached = cache.get(plugin.id);
    const profile =
      cached &&
      cached.candles === state.candles &&
      cached.start === start &&
      cached.end === end &&
      cached.step === step
        ? cached.profile
        : buildProfile(state.candles, start, end, step, options.valueArea ?? 0.7);
    cache.set(plugin.id, { candles: state.candles, start, end, step, profile });
    if (profile.poc >= 0) {
      if (options.mode === 'volume') drawVolume(ctx, profile, g, theme, left, right, top, bottom);
      else drawDelta(ctx, profile, g, theme, left, right, top, bottom);
    }
    right = left - GAP;
  }
  ctx.restore();
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
  const accent = theme.palette.accent;
  // Value area: a bracket along the axis edge.
  const vaTop = g.y(profile.rows[area.high].high),
    vaBottom = g.y(profile.rows[area.low].low);
  ctx.fillStyle = themeColorCSS(theme, '@accent', 0.5);
  ctx.fillRect(right - 1.5, vaTop, 1.5, vaBottom - vaTop);
  // Point of control: a hairline across the plot, with its price at the bar tip.
  const poc = profile.rows[profile.poc];
  const pocY = Math.round((g.y(poc.low) + g.y(poc.high)) / 2) + 0.5;
  const tip = right - width * ((poc.buy + poc.sell) / profile.maxVolume);
  ctx.strokeStyle = themeColorCSS(theme, '@accent', 0.4);
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 3]);
  ctx.beginPath();
  ctx.moveTo(g.left, pocY);
  ctx.lineTo(tip - 4, pocY);
  ctx.stroke();
  ctx.setLineDash([]);
  if (pocY > top + 8 && pocY < bottom - 8) {
    const size = theme.typography.axisSize;
    ctx.font = `${size}px ${theme.typography.numberFamily}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = accent;
    ctx.fillText('POC', tip - 6, pocY - 3);
  }
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
