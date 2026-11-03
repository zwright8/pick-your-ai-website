import { expect, test } from '@playwright/test';

test('builder reports an index write failure without leaving an unlisted build', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pyai.builds.index') {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unsaved build');
  await name.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'Browser storage is full or unavailable.',
  );
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('pyai.build.')),
    ),
  ).toEqual([]);
});
