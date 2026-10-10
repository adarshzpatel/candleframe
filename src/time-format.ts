import { ChartError } from './errors.ts';

const DAY = 86_400_000;

export interface TimeFormats {
  /** Short label for the time axis; depends on the visible span. */
  axis(timeMs: number, spanMs: number): string;
  /** Full label for the crosshair and tooltips. */
  full(timeMs: number): string;
  /** Short name of the zone, such as `UTC` or `EST`. */
  zone: string;
}

/** Interval-aware labels in one IANA time zone. Daily and longer bars never show a clock time. */
export function createTimeFormats(intervalMs: number, timeZone = 'UTC'): TimeFormats {
  const make = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { ...options, timeZone });
    } catch (cause) {
      throw new ChartError('INVALID_TIME_ZONE', 'use an IANA name such as UTC or America/New_York', {
        path: 'timeZone',
        details: { timeZone },
        cause,
      });
    }
  };
  const seconds = intervalMs < 60_000;
  const clock = make({ hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
  const dayClock = make({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const day = make({ month: 'short', day: 'numeric' });
  const month = make({ month: 'short', year: 'numeric' });
  const date = make({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const zonePart = make({ timeZoneName: 'short' })
    .formatToParts(Date.UTC(2026, 0, 15))
    .find(part => part.type === 'timeZoneName');
  return {
    axis(timeMs, spanMs) {
      if (intervalMs >= DAY) return (spanMs >= 300 * DAY ? month : day).format(timeMs);
      return (spanMs >= DAY ? dayClock : clock).format(timeMs);
    },
    full(timeMs) {
      return intervalMs >= DAY ? date.format(timeMs) : `${date.format(timeMs)} ${clock.format(timeMs)}`;
    },
    zone: zonePart?.value ?? timeZone,
  };
}
