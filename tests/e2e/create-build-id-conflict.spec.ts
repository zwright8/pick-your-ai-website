import { expect, test } from '@playwright/test';

test('a duplicate build ID cannot overwrite an existing build', async ({ page }) => {
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
    return { id, key, raw };
  });
  await page.goto('/builds');
  const copy = page.getByRole('button', { name: 'Save a copy', exact: true });
  await expect(copy).toBeEnabled();
  await page.evaluate((id) => {
    const prefix = id.replace('build.local.', '');
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => `${prefix}-0000-4000-8000-000000000000`,
    });
  }, original.id);
  await copy.click();
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'already exists',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), original.key)).toBe(original.raw);
});
