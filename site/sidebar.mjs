/** Sidebar groups, in order. The llms.txt and Markdown endpoints list pages in this order too. */
export const sidebar = [
  {
    label: 'Start here',
    items: ['getting-started/installation', 'getting-started/quick-start', 'examples'],
  },
  {
    label: 'Integrate',
    items: [
      'guides/widget',
      'guides/bare-chart',
      'guides/headless',
      'guides/frameworks',
      'guides/theming',
      'guides/layouts',
    ],
  },
  {
    label: 'Data feeds',
    items: ['feeds/overview', 'feeds/static-data', 'feeds/live-websocket', 'feeds/trade-bars'],
  },
  {
    label: 'Indicators',
    items: ['indicators/build-an-indicator', 'indicators/outputs-and-panes', 'indicators/registry'],
  },
  {
    label: 'Plugins',
    items: ['plugins/overview', 'plugins/trading', 'plugins/drawing-tools'],
  },
  {
    label: 'For agents',
    items: ['agents/overview', 'agents/drive-the-chart', 'agents/mcp-server', 'agents/build-a-feed'],
  },
  {
    label: 'Reference',
    items: ['reference/chart-types', 'reference/commands', 'reference/errors'],
  },
];
