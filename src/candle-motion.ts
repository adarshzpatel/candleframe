import type { Candle } from './types.ts';

const fields = ['open', 'high', 'low', 'close', 'volume'] as const;

/**
 * Presentation-only easing for the forming candle. Ticks inside one bar glide from the
 * displayed values to the new ones; a new bar, or a correction to another bar, snaps.
 * The runtime keeps the exact values.
 */
export class CandleMotion {
  private origin: Candle | null = null;
  private target: Candle | null = null;
  private start = 0;
  private duration = 0;

  get active(): boolean {
    return !!this.duration;
  }

  retarget(candle: Candle | undefined, now: number, duration: number): void {
    if (!candle) {
      this.origin = this.target = null;
      this.duration = 0;
      return;
    }
    if (!this.target || candle.timeMs !== this.target.timeMs || duration <= 0) {
      this.origin = this.target = candle;
      this.duration = 0;
      return;
    }
    if (fields.every(field => candle[field] === this.target![field])) {
      this.target = candle;
      return;
    }
    this.origin = this.sample(now) ?? candle;
    this.target = candle;
    this.start = now;
    this.duration = duration;
  }

  /** The displayed candle. Easing is a convex blend, so high and low still bound the body. */
  sample(now: number): Candle | null {
    const { origin, target } = this;
    if (!origin || !target) return null;
    const progress = this.duration ? Math.min(1, Math.max(0, (now - this.start) / this.duration)) : 1;
    if (progress >= 1) {
      this.duration = 0;
      this.origin = target;
      return target;
    }
    const ease = 1 - (1 - progress) ** 3;
    const shown = { ...target };
    for (const field of fields) shown[field] = origin[field] + (target[field] - origin[field]) * ease;
    return shown;
  }
}
