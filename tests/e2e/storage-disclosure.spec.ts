import { expect, test } from '@playwright/test';

test('fixture deployment describes browser-local build storage consistently', async ({ page }) => {
  await page.goto('/legal');
  await expect(page.getByText('Build snapshots are saved in this browser.')).toBeVisible();
  await expect(page.getByText(/configured API receives build identifiers/)).toHaveCount(0);
  await page.goto('/about');
  await page.getByText('Can I save my builds?').click();
  await expect(
    page.getByText(/Build snapshots are saved in this browser and can be exported/),
  ).toBeVisible();
  await page.goto('/builds');
  await expect(page.getByText(/Your saved configurations live in this browser/)).toBeVisible();
  await expect(page.getByText(/API-backed workspace/)).toHaveCount(0);
});
