import type { DrawingToolDefinition } from './drawing-types.ts';

/** Projection and volume-based tools (Forecasting family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */
/** Projection tools after the position plans. */
export const projectionTools: readonly DrawingToolDefinition[] = [];
/** Volume-based. */
export const volumeTools: readonly DrawingToolDefinition[] = [];
/** 24-unit SVG paths keyed by tool type. */
export const forecastIcons: Readonly<Record<string, string>> = {};
