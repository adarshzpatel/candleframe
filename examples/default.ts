// The smallest embed: a feed and nothing else. Review what ships before any options.
import { createChartWidget, createSimulatedFeed } from '../src/index.ts';

const chart = createChartWidget(document.querySelector<HTMLElement>('#chart')!, {
  feed: createSimulatedFeed(),
});
(window as unknown as { candleframe: typeof chart }).candleframe = chart;
