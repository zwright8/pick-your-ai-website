import { expect, test } from '@playwright/test';

test('a failed copy is reported instead of announced as saved', async ({ page }) => {
  await page.goto('/builds');
  const copy = page.getByRole('button', { name: 'Save a copy', exact: true });
  await expect(copy).toBeEnabled();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.')) {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await copy.click();
  await expect(
    page.locator('.working-card').getByRole('heading', { name: /\(copy\)/ }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'Browser storage is full or unavailable.',
  );
  await expect(page.getByRole('status').filter({ hasText: 'Saved a copy' })).toHaveCount(0);
});

test('a successful copy reports a saved state after persistence', async ({ page }) => {
  await page.goto('/builds');
  const copy = page.getByRole('button', { name: 'Save a copy', exact: true });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(
    page.locator('.working-card').getByRole('heading', { name: /\(copy\)/ }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.reload();
  await expect(
    page.locator('.working-card').getByRole('heading', { name: /\(copy\)/ }),
  ).toBeVisible();
});
