import { test, expect } from '@playwright/test';

// Phase 1 verification: an empty <dri-viewer> mounts, sizes via CSS, and initializes
// the three.js renderer in a real WebGL context.

test('empty widget mounts, sizes via CSS, and initializes the renderer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Capture any `error` event the element dispatches when WebGL init fails.
  await page.addInitScript(() => {
    (window as unknown as { __driErrors: string[] }).__driErrors = [];
    window.addEventListener('error', () => {}, true);
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelector('dri-viewer')?.addEventListener('error', (e) => {
        const detail = (e as CustomEvent<{ error: unknown }>).detail;
        (window as unknown as { __driErrors: string[] }).__driErrors.push(String(detail?.error));
      });
    });
  });

  await page.goto('/');

  const viewer = page.locator('dri-viewer');
  await expect(viewer).toBeAttached();

  // The Viewer core appends its WebGL canvas into the shadow stage once the renderer
  // initializes. A present, non-zero-size canvas proves mount + CSS sizing + renderer.
  const canvasBox = await viewer.evaluate((el) => {
    const canvas = el.shadowRoot?.querySelector('.stage canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  expect(canvasBox, 'renderer canvas should exist in the shadow stage').not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThan(0);
  expect(canvasBox!.height).toBeGreaterThan(0);

  const driErrors = await page.evaluate(
    () => (window as unknown as { __driErrors: string[] }).__driErrors,
  );
  expect(driErrors, 'no WebGL init errors from the element').toEqual([]);
  expect(errors, 'no uncaught page errors').toEqual([]);
});
