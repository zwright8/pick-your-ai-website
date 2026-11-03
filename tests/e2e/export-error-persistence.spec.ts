import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('an invalid export remains visible until dismissed', async ({ page }) => {
  await page.goto('/builder');
  const button = page.getByRole('button', { name: 'Export', exact: true });
  await button.click();
  const warning = page.getByRole('alert').filter({ hasText: 'Add at least 2 components' });
  await expect(warning).toBeVisible();
  await warning.evaluate((element) => {
    const parent = element.parentElement;
    if (!parent) throw new Error('Missing export warning');
    new MutationObserver(() => parent.setAttribute('data-announcement-changed', 'yes')).observe(
      parent,
      { childList: true, characterData: true, subtree: true },
    );
  });
  await button.click();
  await expect(page.locator('.export-failure')).toHaveAttribute('data-announcement-changed', 'yes');
  await page.waitForTimeout(3500);
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss export error' }).click();
  await expect(warning).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('starting another build clears the previous export failure', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Add at least 2 components' });
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(warning).toHaveCount(0);
});

for (const entry of [
  { pageName: 'builder', label: 'Export' },
  { pageName: 'summary', label: 'Export JSON' },
  { pageName: 'summary', label: 'Export Markdown' },
] as const) {
  test(`${entry.pageName} ${entry.label} reports download failures and allows retry`, async ({
    page,
  }) => {
    await page.goto('/templates');
    await page
      .locator('.template-showcase', { hasText: 'Provider-API support chat' })
      .getByRole('button', { name: 'Use this build' })
      .click();
    await waitForSavedRevision(page, 1);
    if (entry.pageName === 'summary') await page.goto('/summary');
    await page.evaluate(() => {
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = () => {
        throw new Error('blocked');
      };
      document.addEventListener(
        'restore-export',
        () => {
          URL.createObjectURL = original;
        },
        { once: true },
      );
    });
    const button = page.getByRole('button', { name: entry.label, exact: true });
    await button.click();
    const warning = page.getByRole('alert').filter({ hasText: 'could not start the export' });
    await expect(warning).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss export error' }).click();
    await expect(button).toBeFocused();
    await button.click();
    await expect(warning).toBeVisible();
    await page.evaluate(() => document.dispatchEvent(new Event('restore-export')));
    const download = page.waitForEvent('download');
    await button.click();
    await download;
    await expect(warning).toHaveCount(0);
  });
}
