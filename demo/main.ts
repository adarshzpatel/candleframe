import { createChartWidget, createSimulatedFeed, createBinanceFeed, sma } from '../src/index.ts';
import type { WidgetMarketSource } from '../src/index.ts';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="demo-heading"><a class="demo-brand" href="#" aria-label="OpenChart home"><svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden="true"><path d="M3 3h8v8H3zM17 3h8v8h-8zM3 17h8v8H3z" stroke="currentColor" stroke-width="1.3"/><path d="M17 17h8v8h-8z" fill="currentColor"/></svg>OpenChart<span class="demo-version">LAB / 03</span></a><nav><span class="demo-caption">An open canvas for the markets.</span><a href="/examples/embed.html">Integration example <span aria-hidden="true">↗</span></a></nav></header>
  <main id="widget-host" aria-label="OpenChart demo"></main>
  <footer class="demo-footer"><span><i></i>Open source. Built to be yours.</span><span>Drag to pan <b>·</b> Scroll to zoom <b>·</b> Double-click to reset</span></footer>`;

const markets: WidgetMarketSource[] = [{
  id: 'simulated', label: 'Simulation', symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'], intervals: ['1m', '5m', '15m', '1h'],
  createFeed: ({ symbol, interval }) => createSimulatedFeed({ symbol: symbol as 'BTC/USD' | 'ETH/USD' | 'SOL/USD', interval }),
}, {
  id: 'binance', label: 'Binance live', symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'], intervals: ['1m', '5m', '15m', '1h'],
  createFeed: ({ symbol, interval }) => createBinanceFeed({ symbol: symbol as 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT', interval }),
}];
const chart = createChartWidget(document.querySelector<HTMLElement>('#widget-host')!, {
  feed: createSimulatedFeed({ seed: 42 }), indicators: [sma(20)], markets, orderBook: true, storageKey: 'demo',
  layoutStore: {
    load(key) {
      // Keep layouts saved by the previous demo available after the UI migration.
      const [, source, symbol, interval] = JSON.parse(key) as string[];
      const saved = localStorage.getItem(key) ?? localStorage.getItem(`openchart.layout.v2:${source}:${symbol}:${interval}`);
      return saved === null ? null : JSON.parse(saved);
    },
    save: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  },
});
declare global { interface Window { openchart: typeof chart } }
window.openchart = chart;
if (import.meta.hot) import.meta.hot.dispose(() => chart.dispose());
