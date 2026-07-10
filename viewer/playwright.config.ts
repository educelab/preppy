import { defineConfig, devices } from '@playwright/test';

// End-to-end / browser verification (real WebGL). The Vite dev server hosts index.html
// and serves the transcoder at /basis/. Headless Chromium needs SwiftShader flags to
// provide a software WebGL context in CI / on machines without a GPU-backed headless GL.
const PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: [
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Serves the *built* bundle for the embed test (embed.spec.ts).
      command: 'node scripts/serve-static.mjs',
      url: 'http://localhost:5174/dist/dri-viewer.js',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
