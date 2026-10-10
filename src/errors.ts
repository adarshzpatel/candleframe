/** Machine-readable failure. `code` is stable; `message` is for people. */
export class ChartError extends Error {
  readonly code: string;
  /** Dotted location of the invalid input, for example `drawings.2.points`. */
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message?: string,
    options: { path?: string; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(
      message ? `${code}: ${message}` : code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ChartError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON(): { code: string; message: string; path?: string; details?: Readonly<Record<string, unknown>> } {
    return { code: this.code, message: this.message, path: this.path, details: this.details };
  }
}

export function isChartError(value: unknown, code?: string): value is ChartError {
  return value instanceof ChartError && (code === undefined || value.code === code);
}

/** Normalizes anything thrown into a ChartError so hosts and agents see one shape. */
export function toChartError(value: unknown): ChartError {
  if (value instanceof ChartError) return value;
  if (value instanceof Error) {
    const match = /^([A-Z][A-Z0-9_]+)(?::\s*(.*))?$/s.exec(value.message);
    return match
      ? new ChartError(match[1], match[2], { cause: value })
      : new ChartError('UNEXPECTED_ERROR', value.message, { cause: value });
  }
  return new ChartError('UNEXPECTED_ERROR', String(value));
}
