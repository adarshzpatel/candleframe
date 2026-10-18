import { ChartRuntime, createSimulatedFeed, sma } from '../src/index.ts';

// The same state and commands used by the browser, with no DOM or GPU required.
const chart = new ChartRuntime(createSimulatedFeed(42), [sma(20)]);
try {
  chart.start();
  chart.execute({ type: 'feed.pause', paused: true });
  const before = chart.inspect();
  chart.execute({ type: 'priceScale.set', minPrice: 67000, maxPrice: 69000 }, before.documentRevision);
  const saved = chart.exportDocument();
  chart.execute({ type: 'priceScale.reset' });
  chart.restoreDocument(saved);
  const latest = chart.inspect().latestCandle!;
  chart.execute(
    {
      type: 'drawing.add',
      drawing: {
        id: 'agent-trend',
        type: 'trendline',
        points: [
          { timeMs: latest.timeMs - 20 * before.feed.intervalMs, price: latest.close - 100 },
          { timeMs: latest.timeMs, price: latest.close + 100 },
        ],
        style: { color: '#79ddb0', width: 2 },
      },
    },
    chart.inspect().documentRevision,
  );
  chart.execute({
    type: 'drawing.update',
    id: 'agent-trend',
    patch: { text: 'Agent annotation', locked: true },
  });
  chart.execute({ type: 'history.undo' });
  chart.execute({ type: 'history.redo' });
  const after = chart.inspect();
  console.log(
    JSON.stringify(
      {
        symbol: after.symbol,
        interval: after.feed.interval,
        simulated: after.simulated,
        candles: after.candleCount,
        documentRevision: after.documentRevision,
        stream: after.stream,
        priceScale: after.document.priceScale,
        indicators: after.indicators,
        drawings: after.document.drawings,
        history: after.history,
        unsupportedDrawingTypes: after.unsupportedDrawingTypes,
      },
      null,
      2,
    ),
  );
} finally {
  chart.dispose();
}
