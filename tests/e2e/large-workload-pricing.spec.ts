import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('a large workload retains its exact projected token quantity', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  await page.getByRole('textbox', { name: 'Requests per day' }).fill('1000000001');
  await page.getByRole('textbox', { name: 'Average input tokens' }).fill('1000000001');
  await page.getByRole('button', { name: 'Apply objectives' }).click();
  await waitForSavedRevision(page, 2);
  await page.goto('/summary');
  const line = page.locator('tr', { hasText: /input tokens 1m/i });
  await expect(line).toContainText('30000000060000.00003');
  await expect(line).toContainText('$90,000,000,180,000.00');
});
