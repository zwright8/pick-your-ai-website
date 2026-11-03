import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('revision comparison distinguishes a removal from the surviving selection promotion', async ({
  page,
}) => {
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await waitForSavedRevision(page, 2);
  await page.goto('/catalog/tool?show=all&add=1');
  await page
    .getByRole('row', { name: /Demo Ticket Writer/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await waitForSavedRevision(page, 3);
  await page.goto('/builder');
  await page
    .locator('.pt tbody tr[data-kind="tool"]')
    .first()
    .getByRole('button', { name: /^Remove / })
    .click();
  await waitForSavedRevision(page, 4);
  await page.goto('/compare?revisions=3,4');
  const region = page.getByRole('region', { name: 'Selection differences' });
  await expect(region.getByRole('row', { name: /Demo Web Search Tool.*Removed/ })).toBeVisible();
  await expect(
    region.getByRole('row', {
      name: /Demo Ticket Writer.*role: secondary.*Demo Ticket Writer.*role: primary.*Changed/,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(region.getByRole('row', { name: /Demo Web Search Tool.*Removed/ })).toBeVisible();
  await expect(
    region.getByRole('row', {
      name: /Demo Ticket Writer.*role: secondary.*role: primary.*Changed/,
    }),
  ).toBeVisible();
});
