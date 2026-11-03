import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('a current catalog version can replace an older saved selection', async ({ page }) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
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
      const model = snapshot.selections.find((selection) => selection.id === 'sel_model');
      if (!model) throw new Error('Missing model');
      model.catalog_item_version = 'older-version';
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto('/builder');
  const selected = page.locator('.pt tbody tr[data-kind="model"]').first();
  await expect(selected).toContainText('Selected version: older-version');
  await expect(selected).toContainText('Current catalog version: demo-2026.10');
  await expect(selected.locator('[data-label="Evidence"]')).toContainText(
    'Not available for selected version',
  );
  await selected.getByRole('button', { name: /Configure Demo Aurora Large/ }).click();
  const dialog = page.getByRole('dialog', { name: /Configure Demo Aurora Large/ });
  await expect(dialog).toContainText('selected version older-version');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/catalog/model?show=all&replace=sel_model');
  const row = page.getByRole('row', { name: /Demo Aurora Large/ });
  await expect(row.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await row.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/replace=sel_model/);
  await waitForSavedRevision(page, 1);
  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Add', exact: true }).click();
  await waitForSavedRevision(page, 2);
  const version = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
    const record = raw
      ? (JSON.parse(raw) as {
          build: { selections: { id: string; catalog_item_version: string }[] };
        })
      : null;
    return record?.build.selections.find((selection) => selection.id === 'sel_model')
      ?.catalog_item_version;
  });
  expect(version).toBe('demo-2026.10');
});

test('a missing catalog record remains configurable', async ({ page }) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('Missing current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Missing saved build');
    const record = JSON.parse(raw) as {
      build: { selections: { id: string; catalog_item_id: string }[] };
      revisions: { selections: { id: string; catalog_item_id: string }[] }[];
    };
    for (const snapshot of [record.build, ...record.revisions]) {
      const model = snapshot.selections.find((selection) => selection.id === 'sel_model');
      if (!model) throw new Error('Missing model');
      model.catalog_item_id = 'demo.model.removed';
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto('/builder');
  const row = page.locator('.pt tbody tr[data-kind="model"]').first();
  await expect(row).toContainText('demo.model.removed');
  await expect(row).toContainText('Not in this catalog');
  await row.getByRole('button', { name: /Configure AI Model/ }).click();
  const dialog = page.getByRole('dialog', { name: /Configure AI Model/ });
  await dialog.getByLabel('Temperature').fill('0.37');
  await dialog.getByRole('button', { name: 'Apply settings' }).click();
  await waitForSavedRevision(page, 2);
  await page.reload();
  await row.getByRole('button', { name: /Configure AI Model/ }).click();
  await expect(
    page.getByRole('dialog', { name: /Configure AI Model/ }).getByLabel('Temperature'),
  ).toHaveValue('0.37');
});

test('a replacement link cannot apply a component to a different kind of slot', async ({
  page,
}) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.goto('/catalog/model?show=all&replace=sel_workload');
  await expect(page.getByText('Replacement unavailable.')).toBeVisible();
  const row = page.getByRole('row', { name: /Demo Aurora Mini/ });
  await expect(row.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await waitForSavedRevision(page, 1);
  await page.getByRole('link', { name: 'Return to the builder' }).click();
  await expect(page).toHaveURL(/\/builder$/);
});
