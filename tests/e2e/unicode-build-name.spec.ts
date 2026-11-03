import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('build names allow the contract limit in Unicode code points', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  const value = '😀'.repeat(160);
  await name.fill(value);
  await expect(name).toHaveValue(value);
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue(value);
});

test('an over-limit name stays visible and is not saved until corrected', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  const overLimit = '😀'.repeat(161);
  await name.fill(overLimit);
  await expect(name).toHaveValue(overLimit);
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('at most 160 characters');
  await name.press('Tab');
  await expect(name).toHaveValue(overLimit);
  expect(await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'))).toBeNull();
  await name.fill('😀'.repeat(160));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('😀'.repeat(160));
});

test('Enter does not commit a name while an input method is composing', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.dispatchEvent('compositionstart');
  await name.fill('漢字');
  await name.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'))).toBeNull();
  await name.dispatchEvent('compositionend');
  await name.press('Enter');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('漢字');
});

test('starting a new build asks before clearing an invalid name', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('😀'.repeat(161));
  const firstDialog = page.waitForEvent('dialog', { timeout: 3000 });
  const firstClick = page.getByRole('button', { name: 'New', exact: true }).click();
  await (await firstDialog).dismiss();
  await firstClick;
  await expect(name).toHaveValue('😀'.repeat(161));
  const secondDialog = page.waitForEvent('dialog');
  const secondClick = page.getByRole('button', { name: 'New', exact: true }).click();
  await (await secondDialog).accept();
  await secondClick;
  await expect(name).not.toHaveValue('😀'.repeat(161));
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('leaving the builder asks before discarding an over-limit name', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('😀'.repeat(161));
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const click = page.getByRole('link', { name: 'Save / history' }).click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('confirm');
  await dialog.dismiss();
  await click;
  await expect(page).toHaveURL(/\/builder$/);
  await expect(name).toHaveValue('😀'.repeat(161));
  const leaveDialog = page.waitForEvent('dialog');
  const leave = page.getByRole('link', { name: 'Save / history' }).click();
  await (await leaveDialog).accept();
  await leave;
  await expect(page).toHaveURL(/\/builds$/);
});

test('reload warns before discarding an over-limit name', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('😀'.repeat(161));
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(name).toHaveValue('😀'.repeat(161));
});

for (const theme of ['light', 'dark']) {
  test(`an over-limit name is accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      (selectedTheme) => localStorage.setItem('pyai.theme', selectedTheme),
      theme,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builder');
    const name = page.getByRole('textbox', { name: 'Build name' });
    await name.fill('😀'.repeat(161));
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription(/at most 160 characters/);
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    const result = await new AxeBuilder({ page })
      .include('.pbar')
      .include('#build-name-error')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });
}
