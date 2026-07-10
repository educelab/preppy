import { test, expect } from '@playwright/test';

// Final Phase 4 verification: the *built* widget (dist/dri-viewer.js) embeds on a plain
// host page with one module <script> + one <dri-viewer> element — no bundler, and the
// Basis transcoder loads from the sibling dist/basis/ (no runtime CDN). Served by
// scripts/serve-static.mjs on :5174. Skips if the build or fixtures are absent.

const BASE = 'http://localhost:5174';

test('built bundle embeds with one script + one element and renders', async ({ page }) => {
  const built = await page.request.get(`${BASE}/dist/dri-viewer.js`);
  test.skip(!built.ok(), 'run `npm run build` first (dist/dri-viewer.js missing)');
  const fixture = await page.request.get(`${BASE}/public/fixtures/PHerc1428Cr04/manifest.json`);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/examples/embed.html`);

  const el = page.locator('dri-viewer');
  await expect(el).toBeAttached();

  // Renders from the built bundle: default variant loads, geometry draws, controls show.
  await expect(el).toHaveJSProperty('activeVariant', 'rgb', { timeout: 20_000 });
  await expect
    .poll(
      () =>
        el.evaluate(
          (n) =>
            (n as unknown as { getRenderStats(): { triangles: number } | null }).getRenderStats()
              ?.triangles ?? 0,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator('dri-viewer .ui')).toBeVisible();

  // The transcoder came from the same-origin sibling dist/basis/, not a CDN.
  const transcoderOk = await page.request.get(`${BASE}/dist/basis/basis_transcoder.wasm`);
  expect(transcoderOk.ok(), 'transcoder shipped beside the bundle').toBe(true);

  expect(pageErrors, 'no uncaught errors in the embedding page').toEqual([]);
});
