import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Phase 9 (revised Phase 12): the raking-light "light ball" lives in a panel toggled by
// the floating ☀ button and docked bottom-right. The shaded-sphere dial's PUCK is the
// sole control — dragging sets azimuth (angle) AND elevation (radius); ←/→ step azimuth,
// ↑/↓ step elevation (the former elevation slider is gone). A Reset button restores
// az 45° / el 22°; a reset-view button reframes the camera; a `raking-change` event lets
// ui="none" hosts track state.
//
// Uses the sample object in public/fixtures/ (gitignored); skips if absent.

const MANIFEST = '/fixtures/PHerc1428Cr04/manifest.json';

type Raking = { azimuth: number; elevation: number };

async function loadDefault(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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

/** Puck distance from the dial centre (108px box ⇒ centre at 54,54). */
async function puckRadius(page: Page): Promise<number> {
  const puck = page.locator('dri-viewer .light-dial-puck');
  const { left, top } = await puck.evaluate((n) => ({
    left: parseFloat((n as HTMLElement).style.left),
    top: parseFloat((n as HTMLElement).style.top),
  }));
  return Math.hypot(left - 54, top - 54);
}

test('☀ button toggles the docked light panel (no slider)', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  const trigger = page.locator('dri-viewer .tbtn.light');
  await expect(trigger).toHaveAttribute('aria-pressed', 'false');
  const panel = page.locator('dri-viewer .light-panel');
  await expect(panel).toBeHidden();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('dri-viewer .light-dial')).toBeVisible();
  await expect(page.locator('dri-viewer .light-el')).toHaveCount(0); // elevation slider gone

  // Toggle (not modal): clicking again just closes it.
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toBeHidden();
});

test('the panel docks bottom-right of the stage', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);
  await page.locator('dri-viewer .tbtn.light').click();

  const near = await page.locator('dri-viewer').evaluate((el) => {
    const stage = el.getBoundingClientRect();
    const panel = el.shadowRoot!.querySelector('.light-panel')!.getBoundingClientRect();
    return {
      rightGap: stage.right - panel.right,
      bottomGap: stage.bottom - panel.bottom,
    };
  });
  expect(near.rightGap).toBeLessThan(30);
  expect(near.bottomGap).toBeLessThan(30);
});

test('dial arrow keys drive azimuth and emit raking-change', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .tbtn.light').click();
  const before = await getRaking(page);

  const dial = page.locator('dri-viewer .light-dial');
  await dial.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // +10° total

  const after = await getRaking(page);
  expect(after.azimuth).toBe(before.azimuth + 10);
  expect(after.elevation).toBe(before.elevation); // ←/→ never touch elevation

  const events = (await page.evaluate(
    () => (window as unknown as { __raking: Raking[] }).__raking,
  )) as Raking[];
  expect(events.at(-1)).toEqual({ azimuth: before.azimuth + 10, elevation: before.elevation });
});

test('↓ lowers elevation and slides the puck radially toward the rim', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .tbtn.light').click();
  const before = await puckRadius(page);
  const beforeEl = (await getRaking(page)).elevation;

  await page.locator('dri-viewer .light-dial').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // −10° elevation → more grazing → puck outward

  expect((await getRaking(page)).elevation).toBe(beforeEl - 10);
  expect(await puckRadius(page)).toBeGreaterThan(before);
});

test('dragging the puck sets both azimuth and elevation', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .tbtn.light').click();
  const dial = page.locator('dri-viewer .light-dial');
  const box = (await dial.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Drag from centre out to the right rim: azimuth → ~0°, elevation → grazing (low).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.42, cy, { steps: 6 });
  await page.mouse.up();

  const after = await getRaking(page);
  // Pointer to the right ⇒ azimuth near 0/360; well out toward the rim ⇒ low elevation.
  expect(Math.min(after.azimuth, 360 - after.azimuth)).toBeLessThan(15);
  expect(after.elevation).toBeLessThan(30);
});

test('Reset restores default az 45° / el 22°', async ({ page }) => {
  test.skip(!(await page.request.get(MANIFEST)).ok(), 'sample assets not present');
  await loadDefault(page);

  await page.locator('dri-viewer .tbtn.light').click();
  // Nudge away from the default first.
  await page.locator('dri-viewer .light-dial').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');

  await page.locator('dri-viewer .light-panel .panel-reset').click();
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

  await page.locator('dri-viewer .tbtn.reset-view').click();
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
  await expect(page.locator('dri-viewer .tbtn.light')).toHaveCount(0);
  await expect(page.locator('dri-viewer .tbtn.reset-view')).toHaveCount(0);
});
