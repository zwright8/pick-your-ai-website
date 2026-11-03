import { expect, test } from '@playwright/test';

test('closing settings asks before discarding edits', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  await page.getByRole('button', { name: 'Configure Demo Aurora Large' }).click();
  const modal = page.getByRole('dialog');
  const tokens = modal.getByRole('textbox', { name: 'Max output (tokens)' });
  await tokens.fill('123');
  const warning = page.waitForEvent('dialog', { timeout: 3000 });
  const close = modal.getByRole('button', { name: 'Close dialog' }).click();
  expect((await warning).type()).toBe('confirm');
  await (await warning).dismiss();
  await close;
  await expect(tokens).toHaveValue('123');
  const escapeWarning = page.waitForEvent('dialog', { timeout: 3000 });
  const escape = page.keyboard.press('Escape');
  await (await escapeWarning).dismiss();
  await escape;
  await expect(tokens).toHaveValue('123');
  const secondWarning = page.waitForEvent('dialog', { timeout: 3000 });
  const cancel = modal.getByRole('button', { name: 'Cancel' }).click();
  await (await secondWarning).accept();
  await cancel;
  await expect(modal).toHaveCount(0);
});

test('reverting a setting allows the dialog to close without a warning', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  await page.getByRole('button', { name: 'Configure Demo Aurora Large' }).click();
  const modal = page.getByRole('dialog');
  const tokens = modal.getByRole('textbox', { name: 'Max output (tokens)' });
  const original = await tokens.inputValue();
  await tokens.fill('123');
  await tokens.fill(original);
  await modal.getByRole('button', { name: 'Close dialog' }).click();
  await expect(modal).toHaveCount(0);
});

test('reload warns before discarding edited settings', async ({ page }) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  await page.getByRole('button', { name: 'Configure Demo Aurora Large' }).click();
  const tokens = page.getByRole('textbox', { name: 'Max output (tokens)' });
  await tokens.fill('123');
  const warning = page.waitForEvent('dialog', { timeout: 3000 });
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(tokens).toHaveValue('123');
});
