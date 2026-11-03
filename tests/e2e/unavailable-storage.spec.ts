import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('a write-blocked browser does not report a memory-only draft as saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unsaved build');
  await name.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'Browser storage is full or unavailable.',
  );
});

test('an inaccessible storage object reports that the draft cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    });
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unsaved build');
  await name.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'Browser storage is unavailable. Builds cannot be saved.',
  );
  await page.goto('/builds');
  await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable');
});

test('saved builds remain readable when storage rejects new writes', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Previously saved');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();

  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    };
  });
  await page.goto('/builds');
  await expect(
    page.getByRole('article').getByRole('heading', { name: /Previously saved/ }),
  ).toBeVisible();
});

test('a failed imported-build save keeps the draft and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.') && sessionStorage.getItem('block-import-save') === 'yes') {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Original saved build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const before = await page.evaluate(() => ({
    id: localStorage.getItem('pyai.currentBuildId'),
    index: localStorage.getItem('pyai.builds.index'),
  }));
  await page.goto('/builds');
  await page.evaluate(() => sessionStorage.setItem('block-import-save', 'yes'));
  const build = JSON.parse(
    readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
  );
  build.name = 'Imported but not yet saved';
  await page.locator('input[type="file"]').setInputFiles({
    name: 'build.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(build)),
  });
  await expect(page).toHaveURL(/\/builder$/);
  await expect(name).toHaveValue(build.name);
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'))).toBe(before.id);
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe(before.index);
  expect(
    await page.evaluate(() =>
      window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ),
  ).toBe(false);
  await page.evaluate(() => sessionStorage.removeItem('block-import-save'));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
        return raw ? JSON.parse(raw).build.name : null;
      }),
    )
    .toBe(build.name);
  await page.reload();
  await expect(name).toHaveValue(build.name);
});
