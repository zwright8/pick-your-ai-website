import { expect, test } from '@playwright/test';

test('URI settings reject invalid values and accept a corrected URI', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  const configure = page.getByRole('button', { name: 'Configure Demo Aurora Large' });
  await configure.click();
  const dialog = page.getByRole('dialog');
  const uri = dialog.getByRole('textbox', { name: 'Weights uri' });
  await uri.fill('not a uri');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(uri).toHaveAttribute('aria-invalid', 'true');
  await expect(uri).toHaveAccessibleDescription(/valid absolute URI/);
  await uri.fill('urn:example:model');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(dialog).toHaveCount(0);
  await configure.click();
  await expect(page.getByRole('textbox', { name: 'Weights uri' })).toHaveValue('urn:example:model');
});
