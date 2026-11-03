import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('fractional GPU hours are retained in the cost breakdown', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Self-hosted open model on one GPU' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  await page.getByRole('button', { name: /Configure Nimbus 1/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /Reserved hours per month/i }).fill('1.1234567');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await waitForSavedRevision(page, 2);
  await page.goto('/summary');
  const line = page.locator('tr', { hasText: /gpu hour/i });
  await expect(line).toContainText('1.1234567');
  await expect(line).toContainText('$1.24');
});
