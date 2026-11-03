import { expect, test } from '@playwright/test';

const routes = [
  { name: 'home', path: '/', heading: /Great AI starts\s*with the right stack/i },
  { name: 'builder', path: '/builder', heading: /Choose your parts/i },
  { name: 'catalog-model', path: '/catalog/model', heading: /Choose an AI model/i },
];

for (const theme of ['light', 'dark'] as const) {
  for (const route of routes) {
    test(`${route.name} in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await page.clock.setFixedTime(new Date('2026-10-16T12:00:00Z'));
      await page.addInitScript((value) => localStorage.setItem('pyai.theme', value), theme);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
      await expect(page.getByRole('note', { name: 'Demo mode' })).toBeVisible();
      if (route.name === 'home') {
        // Fixture analysis resolves in memory, so networkidle does not mean the preview is ready.
        const preview = page.getByRole('group', { name: 'Example demo AI stack' });
        await expect(preview.locator('.preview-footer strong')).toHaveText('$324.00 per 30 days');
        await expect(preview.locator('.preview-stamp')).toHaveText('0 detected conflicts');
      } else if (route.name === 'builder') {
        await expect(page.getByTestId('overall-status')).toContainText(
          'Incomplete — 0 of 4 required choices made',
          { timeout: 20_000 },
        );
        await expect(page.getByText('What was not checked.', { exact: true })).toBeVisible({
          timeout: 20_000,
        });
      } else {
        await expect(page.locator('.plist-head .count')).toContainText(
          '4 of 4 products · 0 compatible · 4 unknown · 0 incompatible',
          { timeout: 20_000 },
        );
        await expect(
          page.getByText('Incomplete — 0 of 4 required choices made', { exact: false }),
        ).toBeVisible({
          timeout: 20_000,
        });
      }
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: [page.getByTestId('build-sha')],
        maxDiffPixels: 0,
        timeout: 45_000,
      });
    });
  }
}
