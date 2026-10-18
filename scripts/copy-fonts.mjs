import { cp, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/lib/fonts/', import.meta.url), { recursive: true });
await cp(new URL('../src/fonts/', import.meta.url), new URL('../dist/lib/fonts/', import.meta.url), {
  recursive: true,
});
// The demo's hashed fonts carry the same license notices.
await mkdir(new URL('../dist/licenses/', import.meta.url), { recursive: true });
for (const name of ['Inter-OFL.txt', 'Paper-Mono-OFL.txt']) {
  await cp(
    new URL(`../src/fonts/${name}`, import.meta.url),
    new URL(`../dist/licenses/${name}`, import.meta.url),
  );
}
