import {
  createChartWidget,
  createSimulatedFeed,
  createBinanceFeed,
  createTheme,
  restoreTheme,
  sma,
} from '../src/index.ts';
import type { ResolvedChartTheme, WidgetMarketSource } from '../src/index.ts';
import './style.css';
import { sampleEquityFeed } from './sample-equity.ts';

const host = document.querySelector<HTMLElement>('#app')!;

const intervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
type SimulatedSymbol = 'BTC/USD' | 'ETH/USD' | 'SOL/USD';
// Real-time trade simulation: irregular prints, bursts, buy and sell aggression, order flow.
const simulate = (symbol: SimulatedSymbol, interval: (typeof intervals)[number]) =>
  createSimulatedFeed({ symbol, interval, trades: true });
const markets: WidgetMarketSource[] = [
  {
    id: 'simulated',
    label: 'Simulation',
    symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    intervals: [...intervals],
    createFeed: ({ symbol, interval }) => simulate(symbol as SimulatedSymbol, interval as '1m'),
  },
  {
    id: 'binance',
    label: 'Binance',
    symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    intervals: [...intervals],
    createFeed: ({ symbol, interval }) =>
      createBinanceFeed({ symbol: symbol as 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT', interval }),
  },
  {
    // Static data with weekend and overnight gaps: the time axis skips closed hours.
    id: 'sample-equity',
    label: 'Sample equity',
    symbols: ['ACME'],
    intervals: ['1h', '1d'],
    createFeed: ({ interval }) => sampleEquityFeed(interval),
  },
];
// `?offline` drops Binance, for the smoke test and network-free work.
if (new URLSearchParams(location.search).has('offline')) markets.splice(1, 1);
// The demo sets numbers and annotations in Paper Mono. A saved appearance still wins.
const paperMono = '"Paper Mono", "SFMono-Regular", Consolas, monospace';
let savedTheme: ResolvedChartTheme | null = null;
try {
  const saved = localStorage.getItem(JSON.stringify(['demo', 'appearance']));
  if (saved) savedTheme = restoreTheme(JSON.parse(saved));
} catch {
  /* Fall back to the Paper Mono theme. */
}
// Canvas text does not re-render when a web font arrives, so wait briefly for it.
await Promise.race([
  document.fonts.load('12px "Paper Mono"'),
  new Promise(resolve => setTimeout(resolve, 1500)),
]).catch(() => {});
const chart = createChartWidget(host, {
  feed: simulate('BTC/USD', '1m'),
  theme:
    savedTheme ??
    createTheme('evergreen', { typography: { numberFamily: paperMono, annotationFamily: paperMono } }),
  indicators: [sma(20)],
  markets,
  orderBook: true,
  autoscaleOnPan: true,
  storageKey: 'demo',
  layoutStore: {
    load(key) {
      // Keep layouts saved by the previous demo available after the UI migration.
      const [, source, symbol, interval] = JSON.parse(key) as string[];
      const saved =
        localStorage.getItem(key) ??
        localStorage.getItem(`openchart.layout.v2:${source}:${symbol}:${interval}`);
      return saved === null ? null : JSON.parse(saved);
    },
    save: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  },
});
declare global {
  interface Window {
    candleframe: typeof chart;
  }
}
window.candleframe = chart;
if (import.meta.hot) import.meta.hot.dispose(() => chart.dispose());
