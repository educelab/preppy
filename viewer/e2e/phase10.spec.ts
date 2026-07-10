import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Phase 10 verification: per-variant runtime brightness/contrast on the base mesh
// albedo. Headless pixel sampling shows adjustments change the mesh albedo; the values
// are per-variant (persist across switches, restored on return) and clear on a new
// manifest; the panel Reset zeroes the current variant; a `image-adjust-change` event
// fires; and ui="none" hides the ◑ button (the API still works).
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

type Adjust = { brightness: number; contrast: number };
type AdjustEvent = Adjust & { id: string };

async function loadDefault(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __variants: string[]; __adjust: AdjustEvent[] };
    w.__variants = [];
    w.__adjust = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.querySelector('dri-viewer');
      el?.addEventListener('variant-change', (e) =>
        w.__variants.push((e as CustomEvent<{ id: string }>).detail.id),
      );
      el?.addEventListener('image-adjust-change', (e) =>
        w.__adjust.push((e as CustomEvent<AdjustEvent>).detail),
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

/** Mean luminance (0–255) over a small cluster near the given normalized point. */
function meanLuminance(page: Page, nx = 0.5, ny = 0.5): Promise<number> {
  return page.locator('dri-viewer').evaluate(
    (n, { nx, ny }) => {
      const el = n as unknown as {
        samplePixel(x: number, y: number): [number, number, number, number] | null;
      };
      const offsets = [
        [0, 0],
        [0.04, 0],
        [-0.04, 0],
        [0, 0.04],
        [0, -0.04],
      ];
      let sum = 0;
      let count = 0;
      for (const [dx, dy] of offsets) {
        const px = el.samplePixel(nx + dx, ny + dy);
        if (px) {
          sum += 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
          count += 1;
        }
      }
      return count ? sum / count : -1;
    },
    { nx, ny },
  );
}

const getAdjust = (page: Page) =>
  page.locator('dri-viewer').evaluate((n) =>
    (n as unknown as { getImageAdjust(): Adjust }).getImageAdjust(),
  ) as Promise<Adjust>;

const setAdjust = (page: Page, a: Partial<Adjust>) =>
  page.locator('dri-viewer').evaluate((n, a) => {
    (n as unknown as { setImageAdjust(a: Partial<Adjust>): void }).setImageAdjust(a);
  }, a);

test('brightness raises and lowers the mesh albedo luminance', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  const baseline = await meanLuminance(page);
  expect(baseline, 'centre samples the lit mesh, not the dark background').toBeGreaterThan(40);

  await setAdjust(page, { brightness: 80 });
  const brighter = await meanLuminance(page);
  expect(brighter).toBeGreaterThan(baseline + 10);

  await setAdjust(page, { brightness: -80 });
  const darker = await meanLuminance(page);
  expect(darker).toBeLessThan(baseline - 10);

  // The change emitted image-adjust-change for the active variant.
  const events = (await page.evaluate(
    () => (window as unknown as { __adjust: AdjustEvent[] }).__adjust,
  )) as AdjustEvent[];
  expect(events.at(-1)).toEqual({ id: 'rgb', brightness: -80, contrast: 0 });
});

test('brightness is per-variant: persists across a switch and restores on return', async ({
  page,
}) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await setAdjust(page, { brightness: 70 });
  const rgbBright = await meanLuminance(page);
  expect(await getAdjust(page)).toEqual({ brightness: 70, contrast: 0 });

  // Switch to another variant — its own adjust is identity.
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('variant', 'ir1050'));
  await expect
    .poll(() => getAdjust(page))
    .toEqual({ brightness: 0, contrast: 0 });

  // Return to rgb — the stored +70 is restored (state + pixels).
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('variant', 'rgb'));
  await expect.poll(() => getAdjust(page)).toEqual({ brightness: 70, contrast: 0 });
  expect(Math.abs((await meanLuminance(page)) - rgbBright)).toBeLessThan(6);
});

test('a new manifest clears the stored adjust', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await setAdjust(page, { brightness: 60, contrast: 30 });
  expect(await getAdjust(page)).toEqual({ brightness: 60, contrast: 30 });

  // Clear and reload the manifest — a fresh object resets per-variant state.
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('manifest', ''));
  await page.evaluate(() => ((window as unknown as { __variants: string[] }).__variants = []));
  await page
    .locator('dri-viewer')
    .evaluate((n, m) => n.setAttribute('manifest', m), MANIFEST);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants))
    .toContain('rgb');
  expect(await getAdjust(page)).toEqual({ brightness: 0, contrast: 0 });
});

test('Adjust panel slider drives the albedo; Reset zeroes it', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);
  const baseline = await meanLuminance(page);

  await page.locator('dri-viewer .popover-trigger.adjust').click();
  const brightness = page.locator('dri-viewer .adjust-panel input[type="range"]').first();
  await brightness.fill('90');
  await brightness.dispatchEvent('input');
  expect(await getAdjust(page)).toEqual({ brightness: 90, contrast: 0 });
  expect(await meanLuminance(page)).toBeGreaterThan(baseline + 10);

  // Second .panel-reset is the Adjust panel's (Light is first).
  await page.locator('dri-viewer .panel-reset').nth(1).click();
  expect(await getAdjust(page)).toEqual({ brightness: 0, contrast: 0 });
  expect(Math.abs((await meanLuminance(page)) - baseline)).toBeLessThan(6);
});

test('adjusting the albedo leaves the measurement value untouched', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);
  const el = page.locator('dri-viewer');

  await page.locator('dri-viewer .popover-trigger.tools').click();
  await page.locator('dri-viewer .measure').click();
  const box = (await el.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
  const label = page.locator('dri-viewer .measure-label');
  await expect(label).toBeVisible();
  const before = await label.textContent();

  await setAdjust(page, { brightness: -90, contrast: 60 });
  // The measurement (geometry-derived overlay) is unaffected by an albedo correction.
  expect(await label.textContent()).toBe(before);
});

test('ui="none" hides the ◑ button (API still works)', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('ui', 'none'));
  await expect(page.locator('dri-viewer .popover-trigger.adjust')).toHaveCount(0);
  // The API is unaffected by chrome visibility.
  await setAdjust(page, { brightness: 25 });
  expect(await getAdjust(page)).toEqual({ brightness: 25, contrast: 0 });
});
