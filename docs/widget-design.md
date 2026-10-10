# Embeddable chart workbench

## Work plan

- [x] Ground the current engine, drawing controls and demo ownership.
- [x] Compare two integration designs.
- [x] Choose the public contract. No approval checkpoint requested.
- [x] Implement the widget and use it in the demo.
- [x] Review isolation, disposal and interaction behavior.

## Grounding

`createChart` owns three canvases, input handlers and one `ChartRuntime`. It accepts a sized host and exposes commands, subscriptions, drawing tools and disposal without UI controls. `demo/main.ts` currently owns market selection, layer toggles, range buttons, persistence, export, order book and global dialogs. `demo/drawing-workbench.ts` queries the entire document for its toolbar and chart, uses fixed IDs and appends its picker to `document.body`. The demo stylesheet applies global element selectors. Copying this workbench into a platform would couple the host page to demo markup and prevent independent widget instances.

The latency fixes already separate cursor painting from market/drawing painting, shorten easing, suppress idle drawing notifications and throttle diagnostic text. Embedding must preserve those paths. Host applications must still supply feed adapters and may use the bare engine. Controls, dialogs and event listeners need instance ownership. Saved layouts must identify their market and widget storage namespace.

The architect skill's nested how/why/arena skills are absent in this environment, as established during the drawing-suite design. Direct tracing and two independent design candidates provide those steps.

## Usage and shape

`createChartWidget(host, { feed, markets, indicators, storageKey, orderBook })` returns `ChartApi`. Hosts call the existing commands, inspection and drawing APIs. The widget mounts one open shadow root with inline styles and delegates canvas behavior to `createChart`. Its disposer closes both UI and engine ownership. `WidgetMarketSource` factories provide disconnected adapters; their asynchronous work remains in the adapter. `WidgetLayoutStore` is the optional persistence boundary.

## Synthesis decision

Two independent candidates considered a separate widget factory and an opt-in `ui` option on `createChart`. The separate factory was selected because it keeps toolbar, storage and catalog ownership out of the engine. Returning the same API avoids a wrapper with pass-through methods. The opt-in candidate contributed instance-owned panels, descriptor-derived controls and guarded asynchronous restore. An `attachControls` API was rejected because it would expose mount locations and lifecycle coordination to consumers.

The implementation keeps three knowledge boundaries: widget controls, drawing editing controls, and market catalog validation. It does not introduce separate load/validate/save lifecycle modules or expose internal DOM nodes through the public API.

## Tradeoffs and review

- Inline styles and an open shadow root provide isolated embedding without a bundler CSS requirement. Theme customization uses documented custom properties.
- Source factories remain synchronous because adapters already own asynchronous connections.
- Session-local saves work without configuration. Durable/custom stores require an explicit namespace.
- Review corrected reconnect dispatch, focus restoration for nested panels, short-history range selection and cleanup after initial host callback failures.
- The two-widget browser example verifies independent drawing controls, save/restore, disposal and remount under conflicting host CSS. Latency regression tests preserve separate cursor/annotation redraw paths.
