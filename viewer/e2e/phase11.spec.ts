import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Phase 11 verification: the control bar is responsive. Wide, everything shows inline
// and the ⋯ expand toggle is absent. Narrow (below the widget-width breakpoint), the bar
// docks to the bottom edge, the band pickers stay visible, and the rest tuck behind the
// ⋯ toggle. In both, controls are reachable, popovers open/dismiss, and nothing overflows
// horizontally.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

async function loadDefault(page: Page): Promise<void> {
  // Disable the panel's entry animation so geometry is stable the moment it mounts
  // (the CSS honours prefers-reduced-motion by dropping the transform animation).
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

/** No part of the page (or widget) overflows horizontally. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
}

test('wide: controls inline, no expand toggle, no overflow', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 1000, height: 700 });
  await loadDefault(page);

  await expect(page.locator('dri-viewer .bands')).toBeVisible();
  await expect(page.locator('dri-viewer .popover-trigger.tools')).toBeVisible();
  await expect(page.locator('dri-viewer .popover-trigger.light')).toBeVisible();
  await expect(page.locator('dri-viewer .popover-trigger.adjust')).toBeVisible();
  await expect(page.locator('dri-viewer .reset-view')).toBeVisible();
  // The ⋯ expand toggle is only for the compact layout.
  await expect(page.locator('dri-viewer .expand-toggle')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('narrow: bar docks to the bottom, bands visible, rest behind ⋯', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 380, height: 720 });
  await loadDefault(page);

  const viewer = page.locator('dri-viewer');
  // Docked: the bar spans the widget width and sits at its bottom edge.
  const geom = await viewer.evaluate((el) => {
    const ui = el.shadowRoot!.querySelector('.ui') as HTMLElement;
    const a = el.getBoundingClientRect();
    const b = ui.getBoundingClientRect();
    return {
      // Tolerances cover the bar's 1px borders / sub-pixel rounding.
      leftAligned: Math.abs(b.left - a.left) < 3,
      fullWidth: Math.abs(b.width - a.width) < 4,
      atBottom: Math.abs(b.bottom - a.bottom) < 3,
    };
  });
  expect(geom).toEqual({ leftAligned: true, fullWidth: true, atBottom: true });

  // Bands stay visible; the expand toggle appears; secondary controls are tucked away.
  await expect(page.locator('dri-viewer .bands')).toBeVisible();
  await expect(page.locator('dri-viewer .expand-toggle')).toBeVisible();
  await expect(page.locator('dri-viewer .popover-trigger.light')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  // Bands are reachable inline: switch a variant.
  await page.locator('dri-viewer .band').nth(1).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __variants: string[] }).__variants))
    .toHaveLength(2);
});

test('narrow: expand reveals the secondary controls; popover opens and dismisses', async ({
  page,
}) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.setViewportSize({ width: 380, height: 720 });
  await loadDefault(page);

  await page.locator('dri-viewer .expand-toggle').click();
  const light = page.locator('dri-viewer .popover-trigger.light');
  await expect(light).toBeVisible();

  await light.click();
  await expect(page.locator('dri-viewer .light-dial')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Esc dismisses the popover even when docked.
  await page.keyboard.press('Escape');
  await expect(light).toHaveAttribute('aria-expanded', 'false');

  // Collapsing hides the secondary controls again.
  await page.locator('dri-viewer .expand-toggle').click();
  await expect(light).toBeHidden();
});
