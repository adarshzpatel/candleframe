# Contributing to CandleFrame

Use Node.js 24 and npm.

```sh
npm ci
npm run dev           # Demo at the printed URL
npm test              # Unit tests, no browser needed
npm run build         # Type check, demo build and library build
npm run format        # Prettier
npm run smoke         # Demo in Chromium, Firefox and WebKit; screenshots in artifacts/smoke
npm run bench         # Main-thread cost of ticks and frames
npm run check:package # After build: exports, Node imports and tarball contents
```

CI runs `format:check`, `test`, `build`, the headless example, `npm pack --dry-run` and the cross-browser smoke test. Run the same commands before opening a pull request.

## Where things live

`AGENTS.md` maps each task to its entry file and lists the rules the engine depends on. Read it before changing the runtime, renderer or widget. `docs/poc.md` records the current contracts.

## Pull requests

- One change per pull request. Add a test for any behavior change in `tests/`.
- Commit subjects follow Conventional Commits (`fix(feed): reject gaps after resume`), 50 characters at most.
- Add a line under "Unreleased" in `CHANGELOG.md` for anything a library user would notice.
- New runtime dependencies need a concrete reason in the pull request description. The library ships with none today.

## Reporting bugs

Include the browser, the feed (simulated seed or provider), and the output of **Inspect state** from the widget footer. That JSON is usually enough to reproduce the state.

By contributing you agree that your work is released under the MIT license in `LICENSE`.
