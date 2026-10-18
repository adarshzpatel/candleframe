import type { DrawingToolDefinition } from './drawing-types.ts';

/** More Fibonacci and Gann tools, and extra pitchforks. Registered in drawing-tools.ts; icons merge into ui-icons.ts. */
/** Fibonacci tools after the speed resistance fan. */
export const fibTools: readonly DrawingToolDefinition[] = [];
/** Gann. */
export const gannTools: readonly DrawingToolDefinition[] = [];
/** Pitchforks after the Schiff pitchfork. */
export const pitchforkTools: readonly DrawingToolDefinition[] = [];
/** 24-unit SVG paths keyed by tool type. */
export const fibIcons: Readonly<Record<string, string>> = {};
