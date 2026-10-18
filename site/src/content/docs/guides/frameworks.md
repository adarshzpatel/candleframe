---
title: Framework integrations
description: Mount the chart widget from React, Vue, Svelte, Angular or a plain script tag, and dispose it when the component goes away.
---

CandleFrame has no framework bindings, and it does not need any. The widget is one function call that takes an element, plus one `dispose()` call. This page shows that pattern in each framework.

The same four rules apply everywhere:

1. **Create the widget in the mount hook.** It needs a real element with a size, which only exists after mount.
2. **Dispose it in the unmount hook.** That closes the feed connection and removes the widget's element.
3. **Keep the instance and the feed out of reactive state.** Store them in a ref, a plain variable or a class field. Reactive proxies add nothing here, and the chart copies the feed's descriptor with `structuredClone`, which fails on a proxy.
4. **Pass a stable feed.** A feed created on every render would reconnect on every render. Create it once, or memoize it, and call `replaceFeed` when the market really changes.

The examples below are not typechecked against each framework. They use only `createChartWidget`, `replaceFeed` and `dispose`.

## React

```tsx nocheck
import { useEffect, useRef } from 'react';
import { createChartWidget } from 'candleframe/widget';
import type { ChartWidgetApi } from 'candleframe/widget';
import type { FeedAdapter } from 'candleframe/core';

export function Chart({ feed }: { feed: FeedAdapter }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartWidgetApi | null>(null);

  useEffect(() => {
    const instance = createChartWidget(host.current!, { feed });
    chart.current = instance;
    return () => {
      instance.dispose();
      chart.current = null;
    };
  }, []); // Mount once. The effect below handles feed changes.

  useEffect(() => {
    chart.current?.replaceFeed(feed);
  }, [feed]);

  return <div ref={host} style={{ height: 600 }} />;
}
```

Create the feed in the parent with `useMemo`, or outside any component, so it keeps its identity between renders:

```tsx nocheck
import { useMemo } from 'react';
import { createSimulatedFeed } from 'candleframe/core';

export function Page({ symbol }: { symbol: 'BTC/USD' | 'ETH/USD' }) {
  const feed = useMemo(() => createSimulatedFeed({ symbol }), [symbol]);
  return <Chart feed={feed} />;
}
```

`replaceFeed` with the feed the chart already has does nothing, so the second effect is harmless on the first render. In development, StrictMode runs effects twice. The cleanup disposes the first widget, so one widget remains.

## Vue

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createChartWidget } from 'candleframe/widget';
import type { ChartWidgetApi } from 'candleframe/widget';
import type { FeedAdapter } from 'candleframe/core';

const props = defineProps<{ feed: FeedAdapter }>();
const host = ref<HTMLDivElement>();
let chart: ChartWidgetApi | undefined; // A plain variable, not ref().

onMounted(() => {
  chart = createChartWidget(host.value!, { feed: props.feed });
});
watch(
  () => props.feed,
  feed => chart?.replaceFeed(feed),
);
onBeforeUnmount(() => {
  chart?.dispose();
  chart = undefined;
});
</script>

<template>
  <div ref="host" style="height: 600px"></div>
</template>
```

In the parent, hold the feed in `shallowRef` or wrap it with `markRaw`. A plain `ref` or `reactive` turns the feed into a deep proxy, and the chart throws when it tries to copy the descriptor.

## Svelte

Svelte 5:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { createChartWidget } from 'candleframe/widget';
  import type { FeedAdapter } from 'candleframe/core';

  let { feed }: { feed: FeedAdapter } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    const chart = createChartWidget(host, { feed });
    return () => chart.dispose();
  });
</script>

<div bind:this={host} style="height: 600px"></div>
```

The function `onMount` returns runs on unmount. If the parent keeps the feed in `$state`, use `$state.raw` so Svelte does not proxy it. To switch markets without remounting, keep the widget in a component-level variable and call `chart.replaceFeed(newFeed)`.

## Angular

```ts nocheck
import { AfterViewInit, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createChartWidget } from 'candleframe/widget';
import type { ChartWidgetApi } from 'candleframe/widget';
import type { FeedAdapter } from 'candleframe/core';

@Component({
  selector: 'app-chart',
  standalone: true,
  template: '<div #host style="height: 600px"></div>',
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) feed!: FeedAdapter;
  @ViewChild('host') host!: ElementRef<HTMLDivElement>;
  private chart?: ChartWidgetApi;

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    // The chart animates and handles pointer events itself; keep that out of change detection.
    this.chart = this.zone.runOutsideAngular(() =>
      createChartWidget(this.host.nativeElement, { feed: this.feed }),
    );
  }

  ngOnDestroy() {
    this.chart?.dispose();
  }
}
```

## Plain HTML

The package is plain ES modules with relative imports, so a browser can load it with no bundler. Copy the built files to a folder your server serves:

```sh
cp -r node_modules/candleframe/dist/lib public/vendor/candleframe
```

```html
<div id="chart" style="height: 600px"></div>
<script type="module">
  import { createChartWidget, createSimulatedFeed } from '/vendor/candleframe/index.js';

  const chart = createChartWidget(document.getElementById('chart'), {
    feed: createSimulatedFeed(),
  });
</script>
```

Keep the `fonts/` folder next to the modules. The widget loads its fonts from there by default. The repository's [`examples/embed.html`](https://github.com/adarshzpatel/candleframe/blob/main/examples/embed.html) works this way, with two widgets and dispose and remount buttons.

## Server-side rendering

Every entry point is safe to import on the server. Nothing touches the DOM until you call `createChartWidget` or `createChart`, and those need a browser. React's `useEffect`, Vue's `onMounted` and Svelte's `onMount` only run in the browser, so those components work in Next.js, Nuxt and SvelteKit as written. In the Next.js App Router, mark the component with `'use client'`.

Angular runs `ngAfterViewInit` on the server too. With Angular SSR, create the widget in an `afterNextRender` callback, or check `isPlatformBrowser` first.

Do not call `createChartWidget` during render or at the top level of a module that the server also runs.

## Next

- [Embed the widget](../widget/) lists the widget's options.
- [Examples](../../examples/) links to runnable code in the repository.
