import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('component settings reject malformed numeric input and preserve valid values', async ({
  page,
}) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  const configure = page.getByRole('button', { name: 'Configure Demo Aurora Large' });
  await configure.click();
  const dialog = page.getByRole('dialog');
  const tokens = dialog.getByRole('textbox', { name: 'Max output (tokens)' });
  const topP = dialog.getByRole('textbox', { name: 'Top p' });
  await tokens.fill('12abc');
  await topP.fill('0');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(tokens).toHaveAttribute('aria-invalid', 'true');
  await expect(topP).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toBeVisible();
  await tokens.fill('123');
  await topP.fill('0.5');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await expect(dialog).toHaveCount(0);
  await configure.click();
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Max output (tokens)' }),
  ).toHaveValue('123');
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Top p' })).toHaveValue('0.5');
});

for (const theme of ['light', 'dark']) {
  test(`settings and validation messages meet contrast requirements in ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript(
      (selectedTheme) => localStorage.setItem('pyai.theme', selectedTheme),
      theme,
    );
    await page.goto('/templates');
    await page
      .locator('.template-showcase', { hasText: 'Provider-API support chat' })
      .getByRole('button', { name: /Use this build/ })
      .click();
    await page.getByRole('button', { name: 'Configure Demo Aurora Large' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Max output (tokens)' }).fill('12abc');
    await dialog.getByRole('textbox', { name: 'Top p' }).fill('0');
    await dialog.getByRole('button', { name: 'Apply settings' }).click();
    const result = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withRules(['color-contrast'])
      .analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
}
