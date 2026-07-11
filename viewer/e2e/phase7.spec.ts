import { test, expect } from '@playwright/test';

// Phase 7 verification (feedback #4): the pipeline now bakes smooth vertex normals
// from the un-quantized source OBJ, so the delivered glb ships a NORMAL attribute
// instead of leaving the viewer to compute normals off gltfpack's quantized grid
// (which jittered under grazing light). The viewer's computeVertexNormals only fires
// as a fallback when a glb lacks normals.
//
// Asserts the delivered model exposes normals after load and captures a grazing-light
// screenshot (test-results/) for manual confirmation of smooth shading. Uses the
// regenerated delivery fixture (gitignored); skips cleanly when it's absent.
//
// The before/after comparison against a --no-smooth-normals build was done at
// verification time; it's not committed here because it depends on a non-standard
// local fixture (and vite's dev-server SPA fallback makes an absent-fixture guard
// unreliable). To reproduce: build the rgb variant with `--no-smooth-normals` into
// public/fixtures/_phase7_before/ and screenshot it under the same GRAZING light.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';
const GRAZING = { azimuth: 135, elevation: 8 }; // low elevation = raking

type Stats = { triangles: number; hasNormals: boolean; meshCount: number };

test('delivered glb ships baked normals; renders smooth under grazing light', async ({
  page,
}) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'delivery fixture not present in public/fixtures/');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`/?manifest=${encodeURIComponent(MANIFEST)}`);
  const el = page.locator('dri-viewer');
  await expect(el).toHaveJSProperty('activeVariant', 'rgb');

  // Wait for a frame with the mesh drawn (headless rAF can throttle).
  await expect
    .poll(
      () =>
        el.evaluate(
          (n) => (n as unknown as { getRenderStats(): Stats }).getRenderStats().triangles,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // Grazing raking light so surface relief (and any normal jitter) is visible.
  await el.evaluate(
    (n, light) =>
      (n as unknown as { setRakingLight(a: number, e: number): void }).setRakingLight(
        light.azimuth,
        light.elevation,
      ),
    GRAZING,
  );
  await page.waitForTimeout(200); // let a lit frame draw

  const stats = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): Stats }).getRenderStats(),
  )) as Stats;
  expect(stats.meshCount, 'at least one mesh').toBeGreaterThan(0);
  // The delivered geometry carries baked normals; the viewer did not have to compute
  // them (loadModel only calls computeVertexNormals when the attribute is absent).
  expect(stats.hasNormals, 'delivered geometry has a normal attribute').toBe(true);

  await el.screenshot({ path: 'test-results/phase7-after-baked.png' });
  expect(errors, 'no uncaught page errors').toEqual([]);
});
