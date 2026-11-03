import { expect, test } from '@playwright/test';

for (const action of ['copy', 'duplicate']) {
  test(`${action} preserves a valid name at the contract limit`, async ({ page }, info) => {
    if (info.project.name.startsWith('mobile'))
      await page.setViewportSize({ width: 320, height: 800 });
    const originalName = 'x'.repeat(160);
    const expectedName = `${'x'.repeat(153)} (copy)`;
    await page.goto('/builder');
    const name = page.getByRole('textbox', { name: 'Build name' });
    await name.fill(originalName);
    await name.press('Tab');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
      .toBeTruthy();
    await page.goto('/builds');
    const original = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: /x{100}/ }) });
    await expect(original).toBeVisible();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    if (action === 'copy') {
      await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
    } else {
      await original.getByRole('button', { name: `Duplicate ${originalName}` }).click();
    }
    await expect
      .poll(() =>
        page.evaluate((expected) => {
          const ids = JSON.parse(localStorage.getItem('pyai.builds.index') ?? '[]') as string[];
          return ids.some((id) => {
            const raw = localStorage.getItem(`pyai.build.${id}`);
            return raw && JSON.parse(raw).build.name === expected;
          });
        }, expectedName),
      )
      .toBe(true);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: expectedName, exact: true }).first(),
    ).toBeVisible();
  });
}
