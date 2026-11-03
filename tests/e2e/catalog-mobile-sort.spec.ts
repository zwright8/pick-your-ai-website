import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('mobile users can choose a sort and keep it after reload', async ({ page }, info) => {
  test.skip(
    !info.project.name.startsWith('mobile'),
    'the mobile control appears on narrow screens',
  );
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.goto('/catalog/model?show=all');
  const sort = page.getByLabel('Sort components');
  await expect(sort).toBeVisible();
  const rows = page.locator('.pt tbody tr');
  await expect(page.getByRole('row', { name: /Demo Aurora Large/ })).toContainText('$324');
  await expect(page.getByRole('row', { name: /Demo Open 70B/ })).toBeVisible();
  await sort.selectOption('cost|desc');
  await expect(page).toHaveURL(/sort=cost/);
  await expect(page).toHaveURL(/dir=desc/);
  await expect(page.getByText(/Complete estimates come first/)).toBeVisible();
  const order = async () => rows.allTextContents();
  await expect
    .poll(async () => {
      const names = await order();
      return (
        names.findIndex((name) => name.includes('Demo Aurora Large')) <
        names.findIndex((name) => name.includes('Demo Open 70B'))
      );
    })
    .toBe(true);
  await page.reload();
  await expect(sort).toHaveValue('cost|desc');
  await sort.selectOption('cost|asc');
  await expect
    .poll(async () => {
      const names = await order();
      return (
        names.findIndex((name) => name.includes('Demo Open 70B')) <
        names.findIndex((name) => name.includes('Demo Aurora Large'))
      );
    })
    .toBe(true);
  await sort.selectOption('recommended');
  await expect(page).not.toHaveURL(/sort=/);
  await expect(page).not.toHaveURL(/dir=/);
});
