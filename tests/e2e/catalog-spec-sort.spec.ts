import { expect, test } from '@playwright/test';

test('specification sorting keeps missing values after known values', async ({ page }, info) => {
  await page.goto('/catalog/integration?show=all');
  const rows = page.locator('.pt tbody tr');
  await expect(page.getByRole('row', { name: /Demo Helpdesk API/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Demo Webhook Notifier/ })).toBeVisible();
  const expectKnownFirst = async () => {
    await expect
      .poll(async () => {
        const names = await rows.allTextContents();
        return (
          names.findIndex((name) => name.includes('Demo Helpdesk API')) <
          names.findIndex((name) => name.includes('Demo Webhook Notifier'))
        );
      })
      .toBe(true);
  };
  if (info.project.name.startsWith('mobile')) {
    const sort = page.getByLabel('Sort components');
    await sort.selectOption('spec:rate_limit_per_minute|asc');
    await expectKnownFirst();
    await sort.selectOption('spec:rate_limit_per_minute|desc');
  } else {
    const sort = page.getByRole('button', { name: /Rate limit per minute/i });
    await sort.click();
    await expectKnownFirst();
    await sort.click();
  }
  await expect(page).toHaveURL(/dir=desc/);
  await expectKnownFirst();
});
