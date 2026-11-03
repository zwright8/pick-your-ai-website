import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('cancelling a new build keeps the current unsaved draft', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pyai.builds.index') throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unsaved build');
  await name.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const click = page.getByRole('button', { name: 'New', exact: true }).click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('confirm');
  await dialog.dismiss();
  await click;
  await expect(name).toHaveValue('Unsaved build');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  const confirmation = page.waitForEvent('dialog');
  const replace = page.getByRole('button', { name: 'New', exact: true }).click();
  await (await confirmation).accept();
  await replace;
  await expect(name).not.toHaveValue('Unsaved build');
});

test('cancelling opening a saved build keeps the unsaved working draft', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.') && sessionStorage.getItem('block-build') === 'yes') {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Saved original');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await name.fill('Second build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.builds.index')))
    .toContain('build.local.');
  await page.evaluate(() => sessionStorage.setItem('block-build', 'yes'));
  await name.fill('Unsaved second build');
  await name.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await page.getByRole('link', { name: 'Save / history' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Saved original' });
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const open = card.getByRole('button', { name: 'Open build' }).click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('confirm');
  await dialog.dismiss();
  await open;
  await expect(page).toHaveURL(/\/builds$/);
  await page.getByRole('button', { name: 'Continue editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue(
    'Unsaved second build',
  );
});

test('deleting the current saved build warns about its unsaved edits', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.') && sessionStorage.getItem('block-build') === 'yes') {
        throw new DOMException('Full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Saved build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.evaluate(() => sessionStorage.setItem('block-build', 'yes'));
  await name.fill('Unsaved edit');
  await name.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await page.getByRole('link', { name: 'Save / history' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Saved build' });
  await card.getByRole('button', { name: 'Delete Saved build' }).click();
  await expect(card.getByRole('group', { name: 'Confirm delete' })).toContainText(
    'Your unsaved changes will be lost.',
  );
  await card.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Continue editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('Unsaved edit');
});

test('a failed save warns before reloading and keeps the draft when the reload is cancelled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pyai.builds.index') throw new DOMException('Full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unsaved build');
  await name.press('Tab');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 });
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(name).toHaveValue('Unsaved build');
});

test('retry saves edits made before and after a temporary storage failure', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('block-build-index', 'yes');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pyai.builds.index' && sessionStorage.getItem('block-build-index') === 'yes') {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('First edit');
  await name.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toBeVisible();
  await name.fill('Later edit');
  await name.press('Tab');
  await page.evaluate(() => sessionStorage.removeItem('block-build-index'));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const stored = id && localStorage.getItem(`pyai.build.${id}`);
        return stored ? (JSON.parse(stored) as { build: { name: string } }).build.name : null;
      }),
    )
    .toBe('Later edit');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        return window.dispatchEvent(event);
      }),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('Later edit');
});

for (const theme of ['light', 'dark']) {
  test(`retry control is accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('pyai.theme', selectedTheme);
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pyai.builds.index') throw new DOMException('Full', 'QuotaExceededError');
        setItem.call(this, key, value);
      };
    }, theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builder');
    await page.getByRole('textbox', { name: 'Build name' }).fill('Unsaved build');
    await page.getByRole('textbox', { name: 'Build name' }).press('Tab');
    await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
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
