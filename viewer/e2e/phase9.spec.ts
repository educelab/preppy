import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Phase 9 verification: the raking-light "light ball" lives in a popover behind the ☀
// button — a shaded-sphere azimuth dial (drag + arrow keys) plus a vertical elevation
// slider that slides the puck radially; a Reset button restores az 45° / el 22°; a
// reset-view button reframes the camera; the popover manages focus/Esc; and a
// `raking-change` event lets ui="none" hosts track state.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

type Raking = { azimuth: number; elevation: number };

async function loadDefault(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __variants: string[]; __raking: Raking[] };
    w.__variants = [];
    w.__raking = [];
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.querySelector('dri-viewer');
      el?.addEventListener('variant-change', (e) =>
        w.__variants.push((e as CustomEvent<{ id: string }>).detail.id),
      );
      el?.addEventListener('raking-change', (e) =>
        w.__raking.push((e as CustomEvent<Raking>).detail),
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

const getRaking = (page: Page) =>
  page
    .locator('dri-viewer')
    .evaluate((n) => (n as unknown as { getRakingLight(): Raking }).getRakingLight()) as Promise<Raking>;

test('☀ popover opens with a11y wiring and closes on Esc, returning focus', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  const trigger = page.locator('dri-viewer .popover-trigger.light');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('dri-viewer .light-dial')).toBeVisible();

  // Opening moves focus into the panel (the popover primitive's focus guarantee).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('dri-viewer')!.shadowRoot!;
        const panel = root.querySelector('.popover-trigger.light')!.closest('.popover')!
          .querySelector('.popover-panel')!;
        return !!root.activeElement && panel.contains(root.activeElement);
      }),
    )
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const focusIsTrigger = await page.evaluate(() => {
    const root = document.querySelector('dri-viewer')!.shadowRoot!;
    return root.activeElement?.classList.contains('light') ?? false;
  });
  expect(focusIsTrigger).toBe(true);
});

test('dial arrow keys drive azimuth and emit raking-change', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .popover-trigger.light').click();
  const before = await getRaking(page);

  const dial = page.locator('dri-viewer .light-dial');
  await dial.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // +10° total

  const after = await getRaking(page);
  expect(after.azimuth).toBe(before.azimuth + 10);
  expect(after.elevation).toBe(before.elevation); // arrows never touch elevation

  const events = (await page.evaluate(
    () => (window as unknown as { __raking: Raking[] }).__raking,
  )) as Raking[];
  expect(events.at(-1)).toEqual({ azimuth: before.azimuth + 10, elevation: before.elevation });
});

test('elevation slider changes elevation and slides the puck radially toward centre', async ({
  page,
}) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .popover-trigger.light').click();
  const puck = page.locator('dri-viewer .light-dial-puck');
  const radius = async () => {
    const { left, top } = await puck.evaluate((n) => ({
      left: parseFloat((n as HTMLElement).style.left),
      top: parseFloat((n as HTMLElement).style.top),
    }));
    return Math.hypot(left - 54, top - 54); // 54 = dial centre (108px box)
  };
  const before = await radius();

  const elevation = page.locator('dri-viewer .light-el input[type="range"]');
  await elevation.fill('85'); // near-overhead → puck near centre
  await elevation.dispatchEvent('input');

  expect((await getRaking(page)).elevation).toBe(85);
  expect(await radius()).toBeLessThan(before); // moved radially inward
});

test('Reset restores default az 45° / el 22°', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .popover-trigger.light').click();
  // Nudge away from the default first.
  await page.locator('dri-viewer .light-dial').focus();
  await page.keyboard.press('ArrowRight');
  const elevation = page.locator('dri-viewer .light-el input[type="range"]');
  await elevation.fill('70');
  await elevation.dispatchEvent('input');

  await page.locator('dri-viewer .panel-reset').first().click(); // Light panel's Reset
  expect(await getRaking(page)).toEqual({ azimuth: 45, elevation: 22 });
});

test('reset-view reframes the camera after a dolly', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);
  const el = page.locator('dri-viewer');

  const framedDist = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): { cameraDistance: number } }).getRenderStats(),
  )) as { cameraDistance: number };

  // Dolly in with the wheel to change the camera distance.
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
  }
  await page.waitForTimeout(150);
  const dollied = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): { cameraDistance: number } }).getRenderStats(),
  )) as { cameraDistance: number };
  expect(Math.abs(dollied.cameraDistance - framedDist.cameraDistance)).toBeGreaterThan(0.5);

  await page.locator('dri-viewer .reset-view').click();
  await page.waitForTimeout(150);
  const reset = (await el.evaluate((n) =>
    (n as unknown as { getRenderStats(): { cameraDistance: number } }).getRenderStats(),
  )) as { cameraDistance: number };
  expect(Math.abs(reset.cameraDistance - framedDist.cameraDistance)).toBeLessThan(0.5);
});

test('ui="none" hides the ☀ and reset-view buttons', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await page.goto(`/?manifest=${encodeURIComponent(MANIFEST)}`);
  await page.locator('dri-viewer').evaluate((n) => n.setAttribute('ui', 'none'));
  await expect(page.locator('dri-viewer .popover-trigger.light')).toHaveCount(0);
  await expect(page.locator('dri-viewer .reset-view')).toHaveCount(0);
});
