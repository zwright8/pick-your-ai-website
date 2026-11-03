import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('unapplied objectives are protected when leaving or starting a new build', async ({
  page,
}) => {
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  const requests = page.getByRole('textbox', { name: 'Requests per day' });
  await requests.fill('1234');
  const navigationDialog = page.waitForEvent('dialog', { timeout: 3000 });
  const navigation = page.getByRole('link', { name: 'Save / history' }).click();
  await (await navigationDialog).dismiss();
  await navigation;
  await expect(page).toHaveURL(/\/builder$/);
  await expect(requests).toHaveValue('1234');
  const newDialog = page.waitForEvent('dialog', { timeout: 3000 });
  const create = page.getByRole('button', { name: 'New', exact: true }).click();
  await (await newDialog).dismiss();
  await create;
  await expect(requests).toHaveValue('1234');
  await page.getByRole('button', { name: 'Apply objectives' }).click();
  await expect(page.locator('.pbar')).toContainText('rev 2');
  await page.getByRole('link', { name: 'Save / history' }).click();
  await expect(page).toHaveURL(/\/builds$/);
});

test('reload warns before discarding unapplied objectives', async ({ page }) => {
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  const requests = page.getByRole('textbox', { name: 'Requests per day' });
  await requests.fill('1234');
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(requests).toHaveValue('1234');
});

test('reverting an objective removes the navigation warning', async ({ page }) => {
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  const requests = page.getByRole('textbox', { name: 'Requests per day' });
  await requests.fill('1234');
  await requests.fill('');
  await page.getByRole('link', { name: 'Save / history' }).click();
  await expect(page).toHaveURL(/\/builds$/);
});

test('confirming a new build clears the unapplied objectives', async ({ page }) => {
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  const requests = page.getByRole('textbox', { name: 'Requests per day' });
  await requests.fill('1234');
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const create = page.getByRole('button', { name: 'New', exact: true }).click();
  await (await dialogPromise).accept();
  await create;
  await expect(requests).toHaveValue('');
  await page.getByRole('link', { name: 'Save / history' }).click();
  await expect(page).toHaveURL(/\/builds$/);
});

test('objectives reject malformed integers and save a corrected value', async ({ page }) => {
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  const requests = page.getByRole('textbox', { name: 'Requests per day' });
  await requests.fill('0x10');
  await page.getByRole('button', { name: 'Apply objectives' }).click();
  await expect(requests).toHaveAttribute('aria-invalid', 'true');
  await expect(requests).toHaveAccessibleDescription(/whole number/);
  await expect(page.locator('.pbar')).toContainText('rev 1');
  await requests.fill('1234');
  await page.getByRole('button', { name: 'Apply objectives' }).click();
  await expect(page.locator('.pbar')).toContainText('rev 2');
  await waitForSavedRevision(page, 2);
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  await expect(page.getByRole('textbox', { name: 'Requests per day' })).toHaveValue('1234');
});
