import { test, expect } from '@playwright/test';

// Phase 2 verification: a real per-object manifest renders — the default variant's
// self-contained glb (embedded KTX2 + KHR_texture_transform via GLTFLoader), with
// computed normals under the light rig, camera framed on load.
//
// Uses the sample object copied into public/fixtures/ (gitignored). Skips cleanly if
// the fixture is absent so the suite still runs without the large assets.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

test('renders the default variant from a real manifest, framed and textured', async ({
  page,
}) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const w = window as unknown as { __variants: string[]; __errors: string[] };
    w.__variants = [];
    w.__errors = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.querySelector('dri-viewer');
      el?.addEventListener('variant-change', (e) =>
        w.__variants.push((e as CustomEvent<{ id: string }>).detail.id),
      );
      el?.addEventListener('error', (e) =>
        w.__errors.push(String((e as CustomEvent<{ error: unknown }>).detail?.error)),
      );
    });
  });

  await page.goto(`/?manifest=${encodeURIComponent(MANIFEST)}`);

  // Default variant ('rgb') should load and emit variant-change.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants), {
      timeout: 20_000,
    })
    .toContain('rgb');

  const el = page.locator('dri-viewer');
  await expect(el).toHaveJSProperty('activeVariant', 'rgb');

  // renderer.info reflects the last drawn frame, so poll until a frame with the mesh
  // has been rendered rather than waiting a fixed time (headless rAF can throttle).
  await expect
    .poll(
      () =>
        el.evaluate(
          (node) =>
            (node as unknown as { getRenderStats(): { triangles: number } }).getRenderStats()
              .triangles,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const stats = await el.evaluate((node) =>
    (node as unknown as { getRenderStats(): unknown }).getRenderStats(),
  );
  const s = stats as {
    triangles: number;
    textures: number;
    meshCount: number;
    hasTexturedMaterial: boolean;
    cameraDistance: number;
  };
  expect(s.meshCount, 'at least one mesh in the scene').toBeGreaterThan(0);
  expect(s.textures, 'embedded KTX2 texture uploaded').toBeGreaterThan(0);
  expect(s.hasTexturedMaterial, 'material has a base-color map').toBe(true);
  // Camera framed on load: a finite, positive eye→target distance (not the 60u default
  // origin framing) sized to the object.
  expect(Number.isFinite(s.cameraDistance)).toBe(true);
  expect(s.cameraDistance).toBeGreaterThan(0);

  const driErrors = await page.evaluate(
    () => (window as unknown as { __errors: string[] }).__errors,
  );
  expect(driErrors, 'no element error events').toEqual([]);
  expect(errors, 'no uncaught page errors').toEqual([]);

  // Visual artifact for manual confirmation of lighting / texture coherence.
  await el.screenshot({ path: 'test-results/phase2-default-rgb.png' });

  // Orbit/zoom controls are live: a wheel over the canvas changes the eye distance.
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); // zoom in
  await page.waitForTimeout(200);
  const zoomed = (await el.evaluate((node) =>
    (node as unknown as { getRenderStats(): { cameraDistance: number } }).getRenderStats(),
  )) as { cameraDistance: number };
  expect(zoomed.cameraDistance, 'wheel zoom changed the camera distance').toBeLessThan(
    s.cameraDistance,
  );
});
