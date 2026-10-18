import {
  createChartWidget,
  createSimulatedFeed,
  createBinanceFeed,
  createHyperliquidFeed,
  createTheme,
  restoreTheme,
  sma,
} from '../src/index.ts';
import type { ResolvedChartTheme, WidgetMarketSource } from '../src/index.ts';
import './style.css';
import { sampleEquityFeed } from './sample-equity.ts';
import { attachTrading, createPaperBroker } from '../src/trading-entry.ts';

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
    // Perpetuals. Hyperliquid weeks start on Thursday, so 1w is not offered.
    id: 'hyperliquid',
    label: 'Hyperliquid',
    symbols: ['BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'HYPE/USDC'],
    intervals: intervals.filter(interval => interval !== '1w'),
    createFeed: ({ symbol, interval }) =>
      createHyperliquidFeed({
        symbol: symbol as 'BTC/USDC' | 'ETH/USDC' | 'SOL/USDC' | 'HYPE/USDC',
        interval,
      }),
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
// `?offline` drops the live exchange sources, for the smoke test and network-free work.
const live = new Set(['binance', 'hyperliquid']);
const sources = new URLSearchParams(location.search).has('offline')
  ? markets.filter(source => !live.has(source.id))
  : markets;
// The demo keeps its Evergreen look and watermark. A saved appearance still wins.
let savedTheme: ResolvedChartTheme | null = null;
try {
  const saved = localStorage.getItem(JSON.stringify(['demo', 'appearance']));
  if (saved) savedTheme = restoreTheme(JSON.parse(saved));
} catch {
  /* Fall back to the demo theme. */
}
const chart = createChartWidget(host, {
  feed: simulate('BTC/USD', '1m'),
  theme: savedTheme ?? createTheme('evergreen', { chart: { watermarkText: 'candleframe' } }),
  indicators: [sma(20)],
  markets: sources,
  autoscaleOnPan: true,
  storageKey: 'demo',
  inspector: true,
  layoutStore: {
    load(key) {
      const saved = localStorage.getItem(key);
      return saved === null ? null : JSON.parse(saved);
    },
    save: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    remove: key => localStorage.removeItem(key),
  },
});
declare global {
  interface Window {
    candleframe: typeof chart;
  }
}
window.candleframe = chart;
// The trading plugin is opt-in: `?trading` adds paper trading against the chart's own prices.
const trading = new URLSearchParams(location.search).has('trading')
  ? attachTrading(chart, { broker: createPaperBroker({ accounts: ['Paper'] }), host, storageKey: 'demo' })
  : null;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    trading?.dispose();
    chart.dispose();
  });
