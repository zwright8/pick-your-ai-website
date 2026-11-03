import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('editing a tool preserves and can explicitly update complex scope values', async ({
  page,
}) => {
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await waitForSavedRevision(page, 2);
  const scopes = ['read,write', '', '  scoped  ', 'read\nwrite'];
  await page.evaluate((scopes) => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('Missing current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Missing saved build');
    const record = JSON.parse(raw) as {
      build: { selections: { id: string; settings: { allowed_scopes?: string[] } }[] };
      revisions: { selections: { id: string; settings: { allowed_scopes?: string[] } }[] }[];
    };
    for (const snapshot of [record.build, ...record.revisions]) {
      const tool = snapshot.selections.find((selection) => selection.id === 'sel_tool');
      if (tool) tool.settings.allowed_scopes = scopes;
    }
    localStorage.setItem(key, JSON.stringify(record));
  }, scopes);
  await page.goto('/builder');
  const row = page.locator('.pt tbody tr[data-kind="tool"]').first();
  await row.getByRole('button', { name: /Configure Demo Web Search Tool/ }).click();
  const dialog = page.getByRole('dialog', { name: /Configure Demo Web Search Tool/ });
  const input = dialog.getByRole('textbox', { name: 'Allowed scopes' });
  await expect(input).toHaveAccessibleDescription(/JSON array of strings/i);
  await expect(input).toHaveValue(JSON.stringify(scopes));
  await dialog.getByRole('textbox', { name: 'Timeout (ms)' }).fill('1234');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await waitForSavedRevision(page, 3);
  await page.reload();
  await row.getByRole('button', { name: /Configure Demo Web Search Tool/ }).click();
  await expect(input).toHaveValue(JSON.stringify(scopes));
  const updated = [...scopes, 'another,scope'];
  await input.fill(JSON.stringify(updated));
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await waitForSavedRevision(page, 4);
  await page.reload();
  await row.getByRole('button', { name: /Configure Demo Web Search Tool/ }).click();
  await expect(input).toHaveValue(JSON.stringify(updated));
  await expect(dialog.getByRole('textbox', { name: 'Timeout (ms)' })).toHaveValue('1234');
});
