import type { IntervalSpec } from './intervals.ts';
import type { Candle, FootprintLevel } from './types.ts';

/**
 * How trades are grouped into bars, as `parseInterval` returns it. `time` bars start on
 * multiples of `ms`; `tick` bars close after `count` trades; `range` bars close when the
 * next trade would stretch the bar beyond `ticks` price increments from low to high.
 */
export type BarRule = IntervalSpec;

/** One print from a trade feed. `side` is the aggressor: `buy` lifted the offer. */
export interface Trade {
  timeMs: number;
  price: number;
  size: number;
  side: 'buy' | 'sell';
}

interface BarState {
  candle: Candle;
  trades: number;
  /** Buy and sell volume per price increment, keyed by price / tickSize. */
  levels: Map<number, [number, number]>;
  delta: number;
  deltaLow: number;
  deltaHigh: number;
}

/**
 * Builds order-flow candles from trades: OHLCV, taker buy volume, a footprint per price
 * increment and the range of running delta inside each bar. Works for time, tick and
 * range bars; tick and range bars take the time of their first trade, nudged forward
 * by a millisecond when two bars would start at the same time.
 */
export class TradeBarBuilder {
  readonly rule: BarRule;
  readonly tickSize: number;
  private readonly decimals: number;
  private readonly bars: BarState[] = [];

  constructor(rule: BarRule, tickSize: number) {
    if (!(tickSize > 0)) throw new RangeError('tickSize must be positive');
    this.rule = rule;
    this.tickSize = tickSize;
    this.decimals = Math.min(12, (String(tickSize).split('.')[1]?.length ?? 0) + 2);
  }

  /** Bars so far, oldest first. The last one may still be forming. */
  get candles(): Candle[] {
    return this.bars.map(b => b.candle);
  }

  /**
   * Applies a trade and returns the bar it changed and whether that bar is new. A trade
   * older than the first time bar returns null; tick and range bars take trades in
   * arrival order.
   */
  add(trade: Trade): { candle: Candle; opened: boolean } | null {
    const target = this.target(trade);
    if (!target) return null;
    const { bar, opened } = target;
    const key = Math.round(trade.price / this.tickSize);
    const level = bar.levels.get(key) ?? [0, 0];
    level[trade.side === 'buy' ? 0 : 1] += trade.size;
    bar.levels.set(key, level);
    bar.trades++;
    bar.delta += trade.side === 'buy' ? trade.size : -trade.size;
    bar.deltaLow = Math.min(bar.deltaLow, bar.delta);
    bar.deltaHigh = Math.max(bar.deltaHigh, bar.delta);
    const c = bar.candle;
    const latest = bar === this.bars.at(-1);
    bar.candle = {
      timeMs: c.timeMs,
      open: c.open,
      high: Math.max(c.high, trade.price),
      low: Math.min(c.low, trade.price),
      // A late trade for an earlier time bar must not move that bar's close.
      close: latest || c.volume === 0 ? trade.price : c.close,
      volume: c.volume + trade.size,
      buyVolume: (c.buyVolume ?? 0) + (trade.side === 'buy' ? trade.size : 0),
      footprint: [...bar.levels]
        .sort((a, b) => a[0] - b[0])
        .map(([k, [buy, sell]]): FootprintLevel => [
          Number((k * this.tickSize).toFixed(this.decimals)),
          buy,
          sell,
        ]),
      deltaRange: [bar.deltaLow, bar.deltaHigh],
    };
    return { candle: bar.candle, opened };
  }

  private open(timeMs: number, price: number): BarState {
    const last = this.bars.at(-1);
    const bar: BarState = {
      candle: {
        timeMs: last && timeMs <= last.candle.timeMs ? last.candle.timeMs + 1 : timeMs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        buyVolume: 0,
      },
      trades: 0,
      levels: new Map(),
      delta: 0,
      deltaLow: 0,
      deltaHigh: 0,
    };
    this.bars.push(bar);
    return bar;
  }

  private target(trade: Trade): { bar: BarState; opened: boolean } | null {
    const last = this.bars.at(-1);
    const timeMs = Math.floor(trade.timeMs);
    const rule = this.rule;
    if (rule.kind === 'time') {
      const start = Math.floor(trade.timeMs / rule.ms) * rule.ms;
      if (!last || start > last.candle.timeMs) return { bar: this.open(start, trade.price), opened: true };
      for (let i = this.bars.length - 1; i >= 0; i--) {
        const bar = this.bars[i]!;
        if (bar.candle.timeMs === start) return { bar, opened: false };
        if (bar.candle.timeMs < start) return null; // No bar for a gap behind the latest one.
      }
      return null;
    }
    if (!last) return { bar: this.open(timeMs, trade.price), opened: true };
    if (rule.kind === 'tick') {
      if (last.trades < rule.count) return { bar: last, opened: false };
      return { bar: this.open(timeMs, trade.price), opened: true };
    }
    const high = Math.max(last.candle.high, trade.price);
    const low = Math.min(last.candle.low, trade.price);
    // Compare in whole increments so 0.25 steps do not accumulate float error.
    if (Math.round((high - low) / this.tickSize) <= rule.ticks) return { bar: last, opened: false };
    return { bar: this.open(timeMs, trade.price), opened: true };
  }
}
