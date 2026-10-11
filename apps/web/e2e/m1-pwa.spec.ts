import { expect, test, type APIRequestContext } from '@playwright/test';
import { waitForServiceWorker } from './helpers';

// Lighthouse 12+ no longer has a PWA category, so "installable" is checked the way
// Chrome itself decides: the manifest's required fields, a controlling service worker,
// and Chrome's own installability verdict via the DevTools protocol. The brand is Ace
// (the icons in public/brand).

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  theme_color: string;
  background_color: string;
  start_url: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

/** A PNG's width × height, read from its IHDR chunk. */
async function pngSize(request: APIRequestContext, src: string): Promise<string> {
  const res = await request.get(src);
  expect(res.ok(), src).toBe(true);
  expect(res.headers()['content-type'], src).toContain('image/png');
  const body = await res.body();
  return `${String(body.readUInt32BE(16))}x${String(body.readUInt32BE(20))}`;
}

test('the web app manifest: Ace, #0B0E14, standalone, icons 192, 512 and maskable 512', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as Manifest;
  expect(manifest.name).toBe('Ace');
  expect(manifest.short_name).toBe('Ace');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#0B0E14');
  expect(manifest.background_color).toBe('#0B0E14');
  expect(manifest.start_url).toBe('/');
  expect(manifest.icons.map((i) => [i.sizes, i.purpose ?? 'any'])).toEqual([
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ]);
  for (const icon of manifest.icons) {
    expect(icon.type).toBe('image/png');
    expect(await pngSize(request, icon.src)).toBe(icon.sizes);
  }
});

test('the page head: title Ace, theme colour, favicons and the apple-touch-icon', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page).toHaveTitle('Ace');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /#0b0e14/i);
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(await pngSize(request, touch ?? '')).toBe('180x180');
  const icons = await page
    .locator('link[rel="icon"]')
    .evaluateAll((links) => links.map((l) => [l.getAttribute('href'), l.getAttribute('type')]));
  expect(icons).toEqual([
    ['/brand/favicon.ico', null],
    ['/brand/favicon.svg', 'image/svg+xml'],
  ]);
  const ico = await request.get('/brand/favicon.ico');
  expect(ico.ok()).toBe(true);
  const svg = await request.get('/brand/favicon.svg');
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
});

test('a service worker controls the page, precaches the icons, and Chrome reports no installability errors', async ({
  page,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // The icons come from the service worker's precache (installing works offline too).
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  for (const path of [
    '/brand/icon-192.png',
    '/brand/icon-512.png',
    '/brand/icon-maskable-512.png',
    '/brand/apple-touch-icon.png',
    '/brand/favicon.svg',
    '/brand/favicon.ico',
  ]) {
    expect(cached, path).toContain(path);
  }

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

test('the app says Ace, never Recall: wordmark, welcome, Settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toContainText(
    'Ace brings each card back right before you’d forget it.',
  );
  await page.goto('/settings');
  await expect(page.getByText(/^Ace \d+\.\d+ · Scheduling by FSRS$/)).toBeVisible();
  // The wordmark is inline SVG in the brand's own lettering, in the text colour.
  const home = page.getByRole('link', { name: 'Ace home' });
  await expect(home).toBeVisible();
  const mark = home.locator('svg');
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  const height = await mark.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(14);
  expect(height).toBeLessThanOrEqual(16);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    page.getByRole('complementary', { name: 'Sidebar' }).getByRole('link', { name: 'Ace home' }),
  ).toBeVisible();
  for (const path of ['/', '/decks', '/stats', '/settings', '/store']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.locator('body').innerText(), path).not.toContain('Recall');
  }
});
