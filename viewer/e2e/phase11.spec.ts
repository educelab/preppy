import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Phase 11 (revised Phase 12): the chrome is a floating top-right cluster of icon buttons
// that toggle panels docked at fixed corners — bands bottom-left (open on load), Light +
// Exposure stacked bottom-right. This verifies both are reachable at wide AND narrow
// widget widths, nothing overflows horizontally, and Light + Exposure stack when both open.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

async function loadDefault(page: Page): Promise<void> {
  // Drop the entry animation so panel geometry is stable the moment it mounts.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const w = window as unknown as { __variants: string[] };
    w.__variants = [];
    document.addEventListener('DOMContentLoaded', () => {
      document
        .querySelector('dri-viewer')
        ?.addEventListener('variant-change', (e) =>
          w.__variants.push((e as CustomEvent<{ id: string }>).detail.id),
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

/** No part of the page overflows horizontally. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
}

test('wide: floating buttons + bands panel open on load, no overflow', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 1000, height: 700 });
  await loadDefault(page);

  for (const cls of ['layers', 'light', 'adjust', 'pan', 'measure', 'reset-view']) {
    await expect(page.locator(`dri-viewer .tbtn.${cls}`)).toBeVisible();
  }
  // Bands are the primary control: their panel is open on load, Layers reads pressed.
  await expect(page.locator('dri-viewer .bands-panel')).toBeVisible();
  await expect(page.locator('dri-viewer .tbtn.layers')).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
});

test('narrow: buttons reachable top-right, bands reachable, no overflow', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 380, height: 720 });
  await loadDefault(page);

  // The toolbar sits at the top-right of the widget.
  const geom = await page.locator('dri-viewer').evaluate((el) => {
    const stage = el.getBoundingClientRect();
    const bar = el.shadowRoot!.querySelector('.toolbar')!.getBoundingClientRect();
    return { rightGap: stage.right - bar.right, topGap: bar.top - stage.top };
  });
  expect(geom.rightGap).toBeLessThan(30);
  expect(geom.topGap).toBeLessThan(30);

  await expect(page.locator('dri-viewer .tbtn.light')).toBeVisible();
  await expect(page.locator('dri-viewer .bands-panel')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Bands reachable: switch a variant.
  await page.locator('dri-viewer .band').nth(1).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants))
    .toHaveLength(2);

  // Opening the Light panel does not introduce horizontal overflow.
  await page.locator('dri-viewer .tbtn.light').click();
  await expect(page.locator('dri-viewer .light-dial')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Light and Exposure panels stack bottom-right when both are open', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 1000, height: 700 });
  await loadDefault(page);

  await page.locator('dri-viewer .tbtn.light').click();
  await page.locator('dri-viewer .tbtn.adjust').click();

  const light = page.locator('dri-viewer .light-panel');
  const adjust = page.locator('dri-viewer .adjust-panel');
  await expect(light).toBeVisible();
  await expect(adjust).toBeVisible();

  // Stacked (not overlapping): both share the right edge and don't intersect vertically.
  const boxes = await page.locator('dri-viewer').evaluate((el) => {
    const l = el.shadowRoot!.querySelector('.light-panel')!.getBoundingClientRect();
    const a = el.shadowRoot!.querySelector('.adjust-panel')!.getBoundingClientRect();
    return { lRight: l.right, aRight: a.right, lBottom: l.bottom, aTop: a.top, lTop: l.top, aBottom: a.bottom };
  });
  expect(Math.abs(boxes.lRight - boxes.aRight)).toBeLessThan(2); // same right edge
  // One sits fully above the other (no vertical overlap).
  const disjoint = boxes.lBottom <= boxes.aTop + 1 || boxes.aBottom <= boxes.lTop + 1;
  expect(disjoint).toBe(true);
});
