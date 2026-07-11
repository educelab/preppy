import { test, expect } from '@playwright/test';

// Phase 3 verification: the widget's core invariant — switching variants preserves the
// camera — plus several 8K KTX2 variants coexisting without OOM / context loss.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';
const VARIANTS = ['pgs', 'pgs-ir940', 'rgb', 'ir1050'];

type Cam = { position: number[]; quaternion: number[]; target: number[] };

const maxDelta = (a: number[], b: number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

async function gotoDefault(page: import('@playwright/test').Page): Promise<void> {
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
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants), {
      timeout: 20_000,
    })
    .toContain('rgb');
}

test('variant switch preserves the camera exactly', async ({ page }) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await gotoDefault(page);
  const el = page.locator('dri-viewer');

  // Move the camera well off the default framing (orbit drag + zoom), then let the
  // OrbitControls damping fully settle so the camera is a static fixed point.
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy - 90, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(2000); // damping settle

  const before = (await el.evaluate((n) =>
    (n as unknown as { getCameraState(): Cam }).getCameraState(),
  )) as Cam;

  // Switch to a different variant (preloaded → cached → near-instant).
  await el.evaluate((n) => n.setAttribute('variant', 'ir1050'));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants))
    .toContain('ir1050');
  await expect(el).toHaveJSProperty('activeVariant', 'ir1050');

  const after = (await el.evaluate((n) =>
    (n as unknown as { getCameraState(): Cam }).getCameraState(),
  )) as Cam;

  // A camera reset (reframing to the object) would move position/target by many units;
  // require them unchanged to a tight bound (only damping/float noise tolerated).
  expect(maxDelta(after.position, before.position), 'camera position preserved').toBeLessThan(0.05);
  expect(maxDelta(after.target, before.target), 'controls target preserved').toBeLessThan(0.05);
  expect(maxDelta(after.quaternion, before.quaternion), 'camera orientation preserved').toBeLessThan(
    0.01,
  );

  await el.screenshot({ path: 'test-results/phase3-switch-ir1050.png' });

  const driErrors = await page.evaluate(
    () => (window as unknown as { __errors: string[] }).__errors,
  );
  expect(driErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('all variants coexist without OOM or context loss', async ({ page }) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await gotoDefault(page);
  const el = page.locator('dri-viewer');

  // Cycle through every variant; each uploads its 8K KTX2 on first render and stays
  // resident in the cache. No OOM/context-loss ⇒ renderer keeps drawing throughout.
  for (const id of VARIANTS) {
    await el.evaluate((n, v) => n.setAttribute('variant', v), id);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants))
      .toContain(id);
    // Poll for a rendered frame (renderer.info is per-frame; headless rAF can throttle).
    await expect
      .poll(
        () =>
          el.evaluate(
            (n) =>
              (n as unknown as { getRenderStats(): { triangles: number } }).getRenderStats()
                .triangles,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  }

  // Preload + cycling leave all variants resident, and several 8K textures uploaded.
  await expect
    .poll(() =>
      el.evaluate((n) => (n as unknown as { cachedVariantCount: number }).cachedVariantCount),
    )
    .toBe(VARIANTS.length);
  const stats = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): { textures: number } }).getRenderStats(),
  )) as { textures: number };
  expect(stats.textures, 'multiple 8K KTX2 textures resident').toBeGreaterThanOrEqual(2);

  const driErrors = await page.evaluate(
    () => (window as unknown as { __errors: string[] }).__errors,
  );
  expect(driErrors, 'no OOM / load errors').toEqual([]);
  expect(pageErrors).toEqual([]);
});
