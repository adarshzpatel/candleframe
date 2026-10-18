---
title: Quick start
description: Mount a chart widget, give it your own candles, add an indicator and clean up.
---

By the end of this page you will have a working chart widget, fed first by the built-in simulation and then by your own candles.

## Mount a widget

The widget fills its container, so give the container a height.

```html
<div id="chart" style="height: 600px"></div>
```

```ts
import { createChartWidget, createSimulatedFeed } from 'candleframe';

const host = document.querySelector<HTMLElement>('#chart')!;
const chart = createChartWidget(host, { feed: createSimulatedFeed() });
```

`createSimulatedFeed()` generates BTC/USD one-minute candles in the browser. It needs no network or API key, so it is the quickest way to see the chart work.

The widget renders inside its own shadow root. You do not import any CSS, and your page styles cannot leak into its buttons.

## Use your own candles

Swap the simulation for `createStaticFeed` and pass an array of candles in ascending time order. Times are UTC milliseconds at the start of each bar.

```ts
import { createChartWidget, createStaticFeed } from 'candleframe';

const feed = createStaticFeed({
  instrument: 'AAPL',
  interval: '1d',
  gaps: true, // Weekends and holidays take no space on the time axis.
  candles: [
    { timeMs: Date.UTC(2026, 0, 5), open: 243.1, high: 245.6, low: 241.9, close: 244.8, volume: 51_200_000 },
    { timeMs: Date.UTC(2026, 0, 6), open: 244.9, high: 247.3, low: 244.0, close: 246.5, volume: 47_900_000 },
    { timeMs: Date.UTC(2026, 0, 7), open: 246.2, high: 246.8, low: 242.7, close: 243.4, volume: 55_300_000 },
  ],
});

const chart = createChartWidget(host, { feed, timeZone: 'America/New_York' });

// Later, from your own socket or poller: appends a bar, or replaces the bar with the same time.
feed.update({ timeMs: Date.UTC(2026, 0, 8), open: 243.5, high: 244.9, low: 242.1, close: 244.2, volume: 12_000 });
```

The feed infers price precision from the data. [Static data](../../feeds/static-data/) covers paging, `setCandles` and instrument metadata.

## Add an indicator

Pass indicator plugins when you create the widget:

```ts
import { createChartWidget, createSimulatedFeed, sma, rsi } from 'candleframe';

const chart = createChartWidget(host, {
  feed: createSimulatedFeed(),
  indicators: [sma(20), rsi(14)],
});
```

RSI draws in its own pane under the price. You can also add one later with a command. Commands go through the same undo history as the toolbar:

```ts
chart.execute({ type: 'indicator.add', indicator: { kind: 'ema', inputs: { period: 50 } } });
```

## Listen for changes

`subscribe` calls your listener right away with the current state, then again on every change. It returns a function that stops the subscription.

```ts
const stop = chart.subscribe(state => {
  const last = state.candles.at(-1);
  console.log(state.feed.instrument.symbol, last?.close, state.documentRevision);
});

stop();
```

## Clean up

Call `dispose()` when the chart leaves the page. It closes the feed connection, removes listeners and observers, and removes the widget's element from your container. Calling it twice is harmless.

```ts
chart.dispose();
```

## Next

- [Embed the widget](../../guides/widget/) covers market pickers, saved layouts and the rest of the options.
- [Framework integrations](../../guides/frameworks/) shows the mount and dispose pattern for React, Vue and Svelte.
- [Data feeds](../../feeds/overview/) explains how to connect a live source.
