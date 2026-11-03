import { expect, test } from '@playwright/test';

test('a mismatched saved-record key cannot target another build', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Original build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const original = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('Missing current build ID');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Missing original record');
    localStorage.setItem('pyai.build.build.mislabeled', raw);
    localStorage.setItem('pyai.builds.index', JSON.stringify(['build.mislabeled', id]));
    return { key, raw };
  });
  await page.goto('/builds');
  const unreadable = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Unreadable saved build' }) });
  await expect(unreadable).toBeVisible();
  await expect(page.getByRole('heading', { name: /Original build.*current/ })).toBeVisible();
  await unreadable.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(unreadable.getByRole('alert')).toContainText('does not match the saved record ID');
  await unreadable.getByRole('button', { name: 'Delete unreadable saved build' }).click();
  await unreadable.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(unreadable).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), original.key)).toBe(original.raw);
  await expect(page.getByRole('heading', { name: /Original build.*current/ })).toBeVisible();
});
