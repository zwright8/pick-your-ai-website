import { expect, test } from '@playwright/test';

test('malformed and outdated component links do not interrupt navigation', async ({
  page,
}, info) => {
  await page.goto('/compare?ids=demo%7Emodel%7Eaurora-large,%25');
  if (info.project.name.startsWith('mobile'))
    await expect(page.getByLabel('Slot 1', { exact: true })).toHaveValue('demo.model.aurora-large');
  else await expect(page.getByRole('link', { name: 'Demo Aurora Large' })).toBeVisible();
  await expect(page.getByText(/component from this link could not be found/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
  const missingSlot = info.project.name.startsWith('mobile')
    ? page.getByLabel('Slot 2', { exact: true })
    : page.getByLabel('Compare slot 2', { exact: true });
  await expect(missingSlot).toHaveValue('%');
  await expect(
    missingSlot.getByRole('option', { name: 'Clear unavailable component' }),
  ).toHaveCount(1);
  await missingSlot.selectOption('');
  await expect(page.getByText(/component from this link could not be found/i)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('ids'))
    .toBe('demo~model~aurora-large');

  await page.goto('/catalog/model/%25');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Browse the catalog' }).click();
  await expect(page).toHaveURL(/\/catalog$/);

  await page.goto('/catalog/model/demo%7Emodel%7Eaurora-mini');
  await expect(page.getByRole('heading', { name: 'Demo Aurora Mini' })).toBeVisible();
});
