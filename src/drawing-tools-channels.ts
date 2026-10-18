import type { DrawingToolDefinition } from './drawing-types.ts';

/** Channels (Lines family) and cycles (Patterns family). Registered in drawing-tools.ts; icons merge into ui-icons.ts. */
/** Channels after the parallel channel. */
export const channelTools: readonly DrawingToolDefinition[] = [];
/** Cycles. */
export const cycleTools: readonly DrawingToolDefinition[] = [];
/** 24-unit SVG paths keyed by tool type. */
export const channelsIcons: Readonly<Record<string, string>> = {};
