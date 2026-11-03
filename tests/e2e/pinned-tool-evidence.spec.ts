import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('a tool pinned to another version does not inherit current catalog behavior', async ({
  page,
}) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await waitForSavedRevision(page, 2);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('Missing current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Missing saved build');
    const record = JSON.parse(raw) as {
      build: { selections: { id: string; catalog_item_version: string }[] };
      revisions: { selections: { id: string; catalog_item_version: string }[] }[];
    };
    for (const snapshot of [record.build, ...record.revisions]) {
      const tool = snapshot.selections.find((selection) => selection.id === 'sel_tool');
      if (tool) tool.catalog_item_version = 'older-version';
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto('/builder');
  const row = page.locator('.pt tbody tr[data-kind="tool"]').first();
  await expect(row).toContainText('Selected version: older-version');
  await expect(row.locator('[data-label="Evidence"]')).toContainText(
    'Not available for selected version',
  );
  const finding = page
    .locator('.pfinding')
    .filter({ hasText: 'Mutating tools require tool-permission guardrails.' });
  await expect(finding).toBeVisible();
  await expect(finding).toContainText('Unknown');
});
