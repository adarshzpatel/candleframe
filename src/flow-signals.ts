import type { Candle } from './types.ts';

export interface FlowSignalOptions {
  /** Bars before each bar that set "normal" volume and range. */
  readonly lookback: number;
  /** A bar qualifies when its volume is at least this multiple of the average. */
  readonly volumeMultiple: number;
  /** Minimum |buy - sell| / volume for aggression, from 0 to 1. */
  readonly minDelta: number;
  /**
   * Minimum |buy - sell| / volume for absorption. Lower than for aggression, because a
   * lopsided bar on short timeframes nearly always moves price. Default `minDelta`.
   */
  readonly absorptionDelta?: number;
  /** Price increment, for the thinnest zone. Default 1% of the bar's range. */
  readonly tickSize?: number;
  /** How many bars a zone may extend to the right; 0 draws markers only. Default 0. */
  readonly zoneBars?: number;
}

/**
 * - `aggression`: one side's market orders moved price their way. `side` 1 for buyers.
 * - `absorption`: one side's market orders failed to move price, because resting orders
 *   took them. `side` is the absorbing side: 1 when bids absorbed selling (bullish).
 */
export interface FlowSignal {
  readonly index: number;
  readonly kind: 'aggression' | 'absorption';
  readonly side: 1 | -1;
  /** Where to draw it: past the bar's extreme for aggression, the absorbing price for absorption. */
  readonly price: number;
  /** Bar volume over the average volume. */
  readonly strength: number;
  /**
   * The price band the signal marks. Absorption: from the bar's extreme to the level
   * where the absorbed side traded most (where resting orders held). Aggression: the
   * base the push launched from, from the extreme to the body.
   */
  readonly zoneLow: number;
  readonly zoneHigh: number;
}

/**
 * Where a signal's zone ends: the first later bar that closes through it (the far side
 * for its direction), or `maxBars` later. `broken` says which. Bullish zones (side 1)
 * break on a close below them, bearish ones on a close above.
 */
export function zoneEnd(
  candles: readonly Candle[],
  signal: FlowSignal,
  maxBars: number,
): { endIndex: number; broken: boolean } {
  const last = Math.min(candles.length - 1, signal.index + maxBars);
  for (let i = signal.index + 1; i <= last; i++) {
    const close = candles[i]!.close;
    if (signal.side === 1 ? close < signal.zoneLow : close > signal.zoneHigh)
      return { endIndex: i, broken: true };
  }
  return { endIndex: last, broken: false };
}

/** Price moved at least this share of the average range for aggression. */
const MOVE_WITH = 0.5;
/** Price moved the delta's way by at most this share of the average range for absorption. */
const HELD = 0.15;
/** Or the bar closed at least this far back from the extreme the delta pushed toward. */
const REJECTED = 0.5;

/** The footprint level with the most volume on one side, or null without a footprint. */
function heaviestLevel(bar: Candle, side: 'buy' | 'sell'): number | null {
  let best: number | null = null;
  let most = 0;
  for (const [price, buy, sell] of bar.footprint ?? []) {
    const volume = side === 'buy' ? buy : sell;
    if (volume > most) {
      most = volume;
      best = price;
    }
  }
  return best;
}

/**
 * Finds aggression and absorption bars in `candles[start..end)`, judging each bar
 * against the `lookback` bars before it. Bars without `buyVolume` are skipped.
 */
export function detectFlowSignals(
  candles: readonly Candle[],
  start: number,
  end: number,
  options: FlowSignalOptions,
): FlowSignal[] {
  const { lookback, volumeMultiple, minDelta } = options;
  const absorptionDelta = options.absorptionDelta ?? minDelta;
  const signals: FlowSignal[] = [];
  const from = Math.max(0, start - lookback);
  // Running sums over the window before each bar.
  let volume = 0,
    range = 0,
    count = 0;
  for (let i = from; i < end; i++) {
    const bar = candles[i]!;
    if (i >= start && count >= Math.ceil(lookback / 2) && bar.buyVolume !== undefined && bar.volume > 0) {
      const avgVolume = volume / count;
      const avgRange = range / count;
      if (bar.volume >= volumeMultiple * avgVolume && avgRange > 0) {
        const delta = (2 * bar.buyVolume - bar.volume) / bar.volume;
        const move = bar.close - bar.open;
        const strength = bar.volume / avgVolume;
        const tick = (options.tickSize ?? (bar.high - bar.low) / 100) || 1e-9;
        /** A band at least one tick thick. */
        const band = (low: number, high: number) => ({
          zoneLow: Math.min(low, high),
          zoneHigh: Math.max(high, low) + (Math.abs(high - low) < tick ? tick : 0),
        });
        if (Math.abs(delta) >= Math.min(minDelta, absorptionDelta)) {
          const side = delta > 0 ? 1 : -1;
          // How far the close fell back from the extreme the delta pushed toward: 0 to 1.
          const span = bar.high - bar.low;
          const pullback = span > 0 ? (side === 1 ? bar.high - bar.close : bar.close - bar.low) / span : 0;
          if (side * move >= MOVE_WITH * avgRange && Math.abs(delta) >= minDelta)
            signals.push({
              index: i,
              kind: 'aggression',
              side,
              price: side === 1 ? bar.low : bar.high,
              strength,
              // The base: from the extreme to the body's near edge.
              ...band(
                side === 1 ? bar.low : Math.max(bar.open, bar.close),
                side === 1 ? Math.min(bar.open, bar.close) : bar.high,
              ),
            });
          else if (
            side * move < MOVE_WITH * avgRange &&
            Math.abs(delta) >= absorptionDelta &&
            (side * move <= HELD * avgRange || pullback >= REJECTED)
          ) {
            // Buyers' orders absorbed by offers, or sellers' by bids: the other side held.
            const absorbed = side === 1 ? 'buy' : 'sell';
            const price = heaviestLevel(bar, absorbed) ?? (side === 1 ? bar.high : bar.low);
            // From the extreme the absorbed side pushed toward to its heaviest level, plus a tick.
            const zone = side === 1 ? band(price, bar.high) : band(bar.low, price);
            signals.push({
              index: i,
              kind: 'absorption',
              side: side === 1 ? -1 : 1,
              price,
              strength,
              ...zone,
            });
          }
        }
      }
    }
    volume += bar.volume;
    range += bar.high - bar.low;
    count++;
    if (i - from >= lookback) {
      const old = candles[i - lookback]!;
      volume -= old.volume;
      range -= old.high - old.low;
      count--;
    }
  }
  return signals;
}
