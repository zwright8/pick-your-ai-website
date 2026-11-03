import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('summary and shared views identify the current catalog record separately from a pinned version', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  const build = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('Missing current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Missing saved build');
    const record = JSON.parse(raw);
    for (const snapshot of [record.build, ...record.revisions]) {
      const selection = snapshot.selections.find((item: { id: string }) => item.id === 'sel_model');
      if (!selection) throw new Error('Missing model');
      selection.catalog_item_version = 'older-version';
    }
    localStorage.setItem(key, JSON.stringify(record));
    return record.build;
  });
  await page.goto('/summary');
  const row = page
    .getByRole('row')
    .filter({ hasText: 'AI Model' })
    .filter({ hasText: 'older-version' });
  await expect(row).toContainText('Current catalog name:');
  await expect(row).toContainText('Current catalog record is synthetic');
  await expect(row.getByText('Synthetic', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Cost breakdown' })).toContainText(
    'current catalog name; selected version: older-version',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const fragment = Buffer.from(JSON.stringify(build)).toString('base64url');
  await page.goto(`/shared#b1.${fragment}`);
  const selected = page.getByRole('listitem').filter({ hasText: 'AI Model:' });
  await expect(selected).toContainText('Current catalog name:');
  await expect(selected).toContainText('Current catalog record is synthetic');
  await expect(selected.getByText('Synthetic', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
