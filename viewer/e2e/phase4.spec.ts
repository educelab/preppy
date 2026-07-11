import { test, expect } from '@playwright/test';

// Phase 4 verification: built-in controls render; two-point measurement returns a real
// cm distance; the raking-light control works; ui="none" hides the chrome.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent. Playwright
// CSS locators pierce the open shadow root, so `.band` / `.measure` resolve inside it.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

async function loadDefault(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __variants: string[]; __measures: unknown[] };
    w.__variants = [];
    w.__measures = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.querySelector('dri-viewer');
      el?.addEventListener('variant-change', (e) =>
        w.__variants.push((e as CustomEvent<{ id: string }>).detail.id),
      );
      el?.addEventListener('measure', (e) => w.__measures.push((e as CustomEvent).detail));
    });
  });
  await page.goto(`/?manifest=${encodeURIComponent(MANIFEST)}`);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants), {
      timeout: 20_000,
    })
    .toContain('rgb');
}

test('renders built-in controls and measures a real cm distance', async ({ page }) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');

  await loadDefault(page);
  const el = page.locator('dri-viewer');

  // Control cluster present, one band button per variant, active band reflected.
  await expect(page.locator('dri-viewer .toolbar')).toBeVisible();
  await expect(page.locator('dri-viewer .band')).toHaveCount(4);
  await expect(page.locator('dri-viewer .band[aria-pressed="true"]')).toHaveText('RGB');

  // Real-scale sanity: the object's world bbox diagonal is tens of cm (a dropped node
  // transform would read quantized units in the thousands).
  const diagonal = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): { boundingDiagonal: number } }).getRenderStats(),
  )) as { boundingDiagonal: number };
  expect(diagonal.boundingDiagonal).toBeGreaterThan(10);
  expect(diagonal.boundingDiagonal).toBeLessThan(200);

  // Enter measure mode (floating top-right button) and click two points on the surface.
  await page.locator('dri-viewer .tbtn.measure').click();
  await expect(page.locator('dri-viewer .tbtn.measure')).toHaveAttribute('aria-pressed', 'true');

  const box = (await el.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);

  const measures = (await page.evaluate(
    () => (window as unknown as { __measures: { distance: number; unit: string }[] }).__measures,
  )) as { distance: number; unit: string }[];
  expect(measures.length, 'a measurement completed').toBeGreaterThanOrEqual(1);
  const m = measures[measures.length - 1]!;
  expect(m.unit).toBe('cm');
  expect(m.distance, 'positive distance').toBeGreaterThan(0);
  expect(m.distance, 'no larger than the object').toBeLessThanOrEqual(
    diagonal.boundingDiagonal * 1.05,
  );

  // The floating label shows the value.
  await expect(page.locator('dri-viewer .measure-label')).toBeVisible();
  await el.screenshot({ path: 'test-results/phase4-measure.png' });
});

test('the light dial drives the raking-light elevation (puck only, no slider)', async ({
  page,
}) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');

  await loadDefault(page);
  const el = page.locator('dri-viewer');

  const before = (await el.evaluate((n) =>
    (n as unknown as { getRakingLight(): { elevation: number } }).getRakingLight(),
  )) as { elevation: number };
  expect(before.elevation).toBe(22); // default rig

  // The elevation slider is gone; the dial's puck (keyboard ↓ here) drives elevation.
  await page.locator('dri-viewer .tbtn.light').click();
  await expect(page.locator('dri-viewer .light-el')).toHaveCount(0); // slider removed
  await page.locator('dri-viewer .light-dial').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // 22 − 15 = 7°

  const after = (await el.evaluate((n) =>
    (n as unknown as { getRakingLight(): { elevation: number } }).getRakingLight(),
  )) as { elevation: number };
  expect(after.elevation).toBe(7);
});

test('ui="none" hides the built-in controls', async ({ page }) => {
  const fixture = await page.request.get(MANIFEST);
  test.skip(!fixture.ok(), 'sample assets not present in public/fixtures/');

  await page.goto(`/?manifest=${encodeURIComponent(MANIFEST)}`);
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('ui', 'none'));
  await expect(page.locator('dri-viewer .ui')).toHaveCount(0);
});
