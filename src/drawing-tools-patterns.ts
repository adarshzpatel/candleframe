import type { DrawingToolDefinition } from './drawing-types.ts';

/** Chart patterns and Elliott waves (Patterns family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */
/** Chart patterns. */
export const patternTools: readonly DrawingToolDefinition[] = [];
/** Elliott waves. */
export const elliottTools: readonly DrawingToolDefinition[] = [];
/** 24-unit SVG paths keyed by tool type. */
export const patternsIcons: Readonly<Record<string, string>> = {};
