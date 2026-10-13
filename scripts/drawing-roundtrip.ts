// Saves a layout with one drawing per registered tool, round-trips it through JSON
// into a fresh runtime, and reports any drawing that did not survive.
// Run: node --experimental-strip-types scripts/drawing-roundtrip.ts
import { ChartRuntime, createSimulatedFeed } from '../src/index.ts';

const source = new ChartRuntime(createSimulatedFeed(42), []);
source.start();
source.execute({ type: 'feed.pause', paused: true });
const latest = source.inspect().latestCandle!;
const step = source.inspect().feed.intervalMs;
const added: string[] = [],
  rejected: string[] = [];
for (const tool of source.drawingRegistry.list()) {
  const count = typeof tool.points === 'number' ? tool.points : 3;
  const points = Array.from({ length: count }, (_, i) => ({
    timeMs: latest.timeMs - (count - i) * 5 * step,
    price: latest.close + (i % 2 ? 50 : -50) * (i + 1),
  }));
  try {
    source.execute({
      type: 'drawing.add',
      drawing: { id: `t-${tool.type}`, type: tool.type, points, text: 'x' },
    });
    added.push(tool.type);
  } catch (error) {
    rejected.push(`${tool.type}: ${String(error)}`);
  }
}
const saved = JSON.parse(JSON.stringify(source.exportDocument()));
const target = new ChartRuntime(createSimulatedFeed(42), []);
target.start();
target.restoreDocument(saved);
const before = source.inspect().document.drawings;
const after = target.inspect().document.drawings;
const missing = before.filter(d => !after.some(a => a.id === d.id)).map(d => d.type);
const changed = before
  .filter(d => after.some(a => a.id === d.id && JSON.stringify(a) !== JSON.stringify(d)))
  .map(d => d.type);
console.log(
  JSON.stringify(
    { tools: added.length, rejected, saved: before.length, restored: after.length, missing, changed },
    null,
    2,
  ),
);
source.dispose();
target.dispose();
