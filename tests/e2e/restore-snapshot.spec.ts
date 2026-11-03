import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('restoring history recovers the selected snapshot locks and extensions after reload', async ({
  page,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Second revision');
  await name.press('Tab');
  await waitForSavedRevision(page, 2);
  const before = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const record = JSON.parse(raw);
    const old = record.revisions[0];
    old.locks.catalog_snapshot_id = 'catalog.original';
    old.extensions = { x_note: 'old' };
    record.build.locks.catalog_snapshot_id = 'catalog.changed';
    record.build.extensions = { x_note: 'new' };
    record.revisions[record.revisions.length - 1] = structuredClone(record.build);
    localStorage.setItem(key, JSON.stringify(record));
    return { id, old };
  });
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Revision history' }).click();
  await page.getByRole('button', { name: 'Restore revision 1 as new revision' }).click();
  await waitForSavedRevision(page, 3);
  const restored = await page.evaluate((id) => {
    const raw = localStorage.getItem(`pyai.build.${id}`);
    if (!raw) throw new Error('No saved build');
    return JSON.parse(raw);
  }, before.id);
  expect(restored.build.locks).toEqual(before.old.locks);
  expect(restored.build.extensions).toEqual({ x_note: 'old' });
  expect(restored.revisions[0]).toEqual(before.old);
  await page.reload();
  await expect(page.locator('.pbar')).toContainText('rev 3');
  await expect(name).toHaveValue(before.old.name);
});
