import { expect, test } from '@playwright/test';
import { waitForServiceWorker } from './helpers';

// Lighthouse 12+ no longer has a PWA category, so "installable" is checked the way
// Chrome itself decides: the manifest's required fields, a controlling service worker,
// and Chrome's own installability verdict via the DevTools protocol.

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  theme_color: string;
  start_url: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

test('the web app manifest has name, icons, theme colour and standalone display', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as Manifest;
  expect(manifest.name).toBe('Recall');
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.start_url).toBe('/');
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('a service worker controls the page, and Chrome reports no installability errors', async ({
  page,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors).toEqual([]);
});

test('API responses are never cached: the service worker has no runtime caching', async ({
  page,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const cacheNames = await page.evaluate(() => caches.keys());
  // Only Workbox's precache (the app shell) exists.
  expect(cacheNames.every((name) => name.startsWith('workbox-precache'))).toBe(true);
});
