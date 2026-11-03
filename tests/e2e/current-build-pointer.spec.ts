import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a saved build reports when its current-build pointer cannot be written', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('block-current-pointer', 'yes');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key === 'pyai.currentBuildId' &&
        sessionStorage.getItem('block-current-pointer') === 'yes'
      ) {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Saved but not current');
  await name.press('Tab');
  const status = page.getByRole('status').filter({ hasText: 'could not remember' });
  await expect(status).toContainText('saved');
  await page.getByRole('link', { name: 'Save / history' }).click();
  await expect(
    page.getByRole('article').getByRole('heading', { name: /Saved but not current/ }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('block-current-pointer'));
  await page.getByRole('button', { name: 'Retry remembering current build' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Saved but not current.*current/ })).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`current-build warning is accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('pyai.theme', selectedTheme);
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pyai.currentBuildId') throw new DOMException('Full', 'QuotaExceededError');
        setItem.call(this, key, value);
      };
    }, theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builder');
    const name = page.getByRole('textbox', { name: 'Build name' });
    await name.fill('Saved draft');
    await name.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Retry remembering current build' }),
    ).toBeVisible();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    const result = await new AxeBuilder({ page })
      .include('.pbox-save-error')
      .include('.save-retry')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
}

test('opening a saved build reports a current-pointer failure and can retry it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key === 'pyai.currentBuildId' &&
        sessionStorage.getItem('block-current-pointer') === 'yes'
      ) {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('First saved build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const firstId = await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'));
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await name.fill('Second saved build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .not.toBe(firstId);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const raw = id && localStorage.getItem(`pyai.build.${id}`);
        return raw ? (JSON.parse(raw) as { build: { name: string } }).build.name : null;
      }),
    )
    .toBe('Second saved build');
  await page.getByRole('link', { name: 'Save / history' }).click();
  await page.evaluate(() => sessionStorage.setItem('block-current-pointer', 'yes'));
  const card = page.getByRole('article').filter({ hasText: 'First saved build' });
  await card.getByRole('button', { name: 'Open build' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'could not remember' })).toBeVisible();
  await expect(name).toHaveValue('First saved build');
  await page.evaluate(() => sessionStorage.removeItem('block-current-pointer'));
  await page.getByRole('button', { name: 'Retry remembering current build' }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBe(firstId);
});
