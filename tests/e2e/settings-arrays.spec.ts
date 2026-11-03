import { expect, test } from '@playwright/test';

test('tool settings reject duplicate scopes and save distinct scopes', async ({ page }) => {
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.getByRole('link', { name: /Back to builder/ }).click();
  const configure = page.getByRole('button', { name: 'Configure Demo Web Search Tool' });
  await configure.click();
  const dialog = page.getByRole('dialog');
  const scopes = dialog.getByRole('textbox', { name: 'Allowed scopes' });
  await scopes.fill('read, write, read');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(scopes).toHaveAttribute('aria-invalid', 'true');
  await expect(scopes).toHaveAccessibleDescription(/duplicate/i);
  await scopes.fill('read, write');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(dialog).toHaveCount(0);
  await configure.click();
  await expect(page.getByRole('textbox', { name: 'Allowed scopes' })).toHaveValue('read, write');
});
