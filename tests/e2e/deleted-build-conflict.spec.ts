import { expect, test } from '@playwright/test';

test('a stale tab does not recreate a build deleted in another tab', async ({ page, context }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Shared draft');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const id = await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'));
  if (!id) throw new Error('Missing saved build ID');

  const other = await context.newPage();
  await other.goto('/builds');
  const card = other
    .getByRole('article')
    .filter({ has: other.getByRole('heading', { name: /Shared draft/ }) });
  await card.getByRole('button', { name: 'Delete Shared draft' }).click();
  await card.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(`pyai.build.${key}`), id))
    .toBeNull();

  await name.fill('Unsaved stale edit');
  await name.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'This build no longer exists in this browser',
  );
  expect(await page.evaluate((key) => localStorage.getItem(`pyai.build.${key}`), id)).toBeNull();
  await expect(name).toHaveValue('Unsaved stale edit');
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'This build no longer exists in this browser',
  );
  expect(await page.evaluate((key) => localStorage.getItem(`pyai.build.${key}`), id)).toBeNull();
  await expect(name).toHaveValue('Unsaved stale edit');
});

test('a stale delete confirmation does not remove a newer saved revision', async ({
  page,
  context,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Original build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const id = await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'));
  if (!id) throw new Error('Missing saved build ID');

  const other = await context.newPage();
  await other.goto('/builds');
  const card = other.getByRole('article').filter({ hasText: 'Original build' });
  await card.getByRole('button', { name: 'Delete Original build' }).click();
  await name.fill('Updated in another tab');
  await name.press('Tab');
  await expect
    .poll(() =>
      page.evaluate((buildId) => {
        const raw = localStorage.getItem(`pyai.build.${buildId}`);
        return raw ? (JSON.parse(raw) as { build: { name: string } }).build.name : null;
      }, id),
    )
    .toBe('Updated in another tab');
  await card.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(other.getByRole('alert')).toContainText('changed');
  await expect(
    other.getByRole('article').filter({ hasText: 'Updated in another tab' }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate((buildId) => localStorage.getItem(`pyai.build.${buildId}`), id))
    .toContain('Updated in another tab');
  const updatedCard = other.getByRole('article').filter({ hasText: 'Updated in another tab' });
  await updatedCard.getByRole('button', { name: 'Delete Updated in another tab' }).click();
  await updatedCard.getByRole('button', { name: 'Yes, delete' }).click();
  await expect
    .poll(() => page.evaluate((buildId) => localStorage.getItem(`pyai.build.${buildId}`), id))
    .toBeNull();
});
