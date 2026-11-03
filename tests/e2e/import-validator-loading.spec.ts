import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
);
const assets = new URL('../../dist/assets/', import.meta.url);
const validator = readdirSync(assets).find(
  (name) =>
    name.startsWith('validators-') &&
    name.endsWith('.js') &&
    statSync(new URL(name, assets)).size > 100_000,
);

test('a file selected before validators load waits and opens successfully', async ({ page }) => {
  expect(validator).toBeDefined();
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(`**/assets/${validator}`, async (route) => {
    requested();
    await pending;
    await route.continue();
  });
  await page.addInitScript(() => {
    const original = Blob.prototype.text;
    Blob.prototype.text = async function () {
      const contents = await original.call(this);
      if (this instanceof File && this.name === 'early.json')
        Reflect.set(window, '__earlyRead', true);
      return contents;
    };
  });
  try {
    await page.goto('/shared');
    await seen;
    await page.locator('input[type="file"]').setInputFiles({
      name: 'early.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...fixture, name: 'Early selection' })),
    });
    await page.waitForFunction(() => Reflect.get(window, '__earlyRead') === true);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Early selection');
  } finally {
    release();
  }
});

test('a failed validator download explains why a shared link cannot open', async ({ page }) => {
  expect(validator).toBeDefined();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = true;
  await page.route(`**/assets/${validator}`, (route) =>
    fail ? route.abort('failed') : route.continue(),
  );
  const encoded = Buffer.from(JSON.stringify(fixture)).toString('base64url');
  await page.goto(`/shared#b1.${encoded}`);
  await expect(page.getByRole('alert')).toContainText('Could not load build validation');
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(page.getByText('Opening shared build…')).toHaveCount(0);
  expect(errors).toEqual([]);
  fail = false;
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fixture.name);
});

test('a failed validator download reports a file import error', async ({ page }) => {
  expect(validator).toBeDefined();
  await page.route(`**/assets/${validator}`, (route) => route.abort('failed'));
  await page.goto('/shared');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'build.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('alert')).toContainText('Could not load build validation');
  await expect(page.getByRole('alert')).toContainText('Reload');
});

for (const theme of ['light', 'dark']) {
  test(`validator failure message is accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      (selectedTheme) => localStorage.setItem('pyai.theme', selectedTheme),
      theme,
    );
    await page.route(`**/assets/${validator}`, (route) => route.abort('failed'));
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/shared#b1.YQ');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Shared build unavailable' }),
    ).toBeVisible();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    const result = await new AxeBuilder({ page })
      .include('[role="alert"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });
}

test('builder explains validator failure and reloads once it is available', async ({ page }) => {
  expect(validator).toBeDefined();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = true;
  await page.route(`**/assets/${validator}`, (route) =>
    fail ? route.abort('failed') : route.continue(),
  );
  await page.goto('/builder');
  await expect(page.getByRole('alert')).toContainText('Could not load build validation');
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  expect(errors).toEqual([]);
  fail = false;
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Choose your parts');
});

test('catalog offers reload when validator loading fails', async ({ page }) => {
  expect(validator).toBeDefined();
  let fail = true;
  await page.route(`**/assets/${validator}`, (route) =>
    fail ? route.abort('failed') : route.continue(),
  );
  await page.goto('/catalog');
  await expect(page.getByRole('alert')).toContainText('Could not load build validation');
  fail = false;
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('All components');
});
