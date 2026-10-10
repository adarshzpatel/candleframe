import { ChartError } from './errors.ts';
import type { IndicatorPlugin } from './types.ts';

/** Recomputes the affected suffix; last-bar updates never accumulate twice. */
export function sma(period = 20): IndicatorPlugin {
  if (!Number.isInteger(period) || period < 1) throw new ChartError('INVALID_PERIOD');
  return {
    id: `sma-${period}`,
    name: `SMA ${period}`,
    themeColor: 'indicator',
    color: [0.66, 0.74, 1, 0.95],
    calculate(candles, previous, changedIndex) {
      const start = previous.length ? Math.max(0, Math.min(changedIndex, previous.length)) : 0;
      const values = previous.slice(0, start);
      let sum = 0;
      for (let i = Math.max(0, start - period + 1); i < start; i++) sum += candles[i].close;
      for (let i = start; i < candles.length; i++) {
        sum += candles[i].close;
        values[i] = i >= period - 1 ? sum / period : Number.NaN;
        if (i >= period - 1) sum -= candles[i - period + 1].close;
      }
      return values;
    },
  };
}
