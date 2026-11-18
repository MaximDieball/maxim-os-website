import { defineConfig, devices, type Project } from '@playwright/test';

/** Simuliert die offene Bildschirmtastatur: sichtbare Höhe ca. 45 % kleiner. */
const withKeyboard = (height: number) => Math.round(height * 0.55);

const mobile = (width: number, height: number): Project['use'] => ({
  browserName: 'chromium',
  userAgent: devices['Pixel 7'].userAgent,
  viewport: { width, height: withKeyboard(height) },
  screen: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts/test-results',
  snapshotPathTemplate: '{testDir}/../__snapshots__/{projectName}/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    reducedMotion: 'reduce',
    trace: 'off',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile-390', use: mobile(390, 844) },
    { name: 'mobile-360', use: mobile(360, 640) },
    {
      // Nur für den Eingabe-Spike: iOS-Safari-Engine, keine Screenshot-Regression.
      name: 'mobile-webkit',
      grep: /@spike/,
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: withKeyboard(844) } },
    },
  ],
});
