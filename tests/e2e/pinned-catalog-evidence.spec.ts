import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('a missing pinned catalog does not produce current prices or compatibility', async ({
  page,
}) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No saved build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved record');
    const record = JSON.parse(raw);
    record.build.locks.catalog_snapshot_id = 'catalog.unavailable';
    for (const revision of record.revisions)
      revision.locks.catalog_snapshot_id = 'catalog.unavailable';
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.reload();
  const model = page.getByRole('row', { name: /Demo Aurora Large/ }).first();
  await expect(model.locator('[title="The locked catalog snapshot is unavailable."]')).toHaveText(
    'Unknown',
  );
  await expect(model).not.toContainText('$324');
  await expect(
    page.getByText(/Catalog snapshot catalog\.unavailable is not available/i).first(),
  ).toBeVisible();
  await expect(page.getByTestId('overall-status')).toContainText('Not evaluated yet');
  await expect(
    page.getByTestId('overall-status').locator('.pstat', { hasText: 'Unknown checks' }),
  ).toContainText('Not evaluated');
  await expect(
    page.getByTestId('overall-status').locator('.pstat', { hasText: 'Required' }),
  ).toContainText('Not evaluated');
  await expect(page.getByText('Requirements not evaluated').first()).toBeVisible();
  await page.goto('/catalog/model?show=all');
  const candidate = page.getByRole('row', { name: /Demo Aurora Large/ }).first();
  await expect(
    candidate.locator('[title="The locked catalog snapshot is unavailable."]'),
  ).toContainText('Unknown');
  const context = page.getByLabel('Build context and filters');
  await expect(context.locator('.pbox-row', { hasText: 'Required' })).toContainText(
    'Not evaluated',
  );
  await expect(context.locator('.pbox-row', { hasText: 'Conflicts' })).toContainText(
    'Not evaluated',
  );
  await expect(context.locator('.pbox-row', { hasText: 'Unknown checks' })).toContainText(
    'Not evaluated',
  );
  await page.goto('/catalog/model/demo~model~aurora-large');
  await expect(
    page.getByText(/Unknown — The locked catalog snapshot is unavailable/),
  ).toBeVisible();
  await page.goto('/compare?ids=demo~model~aurora-large');
  await expect(
    page.locator('[title="The locked catalog snapshot is unavailable."]').first(),
  ).toHaveText('Unknown');
  await page.goto('/summary');
  await expect(page.getByText(/this site has catalog\.demo\.1/i)).toBeVisible();
  await expect(
    page.getByText(/Catalog snapshot catalog\.unavailable is not available/i).first(),
  ).toBeVisible();
  const findings = page.getByRole('region', { name: 'Findings' });
  await expect(findings).toContainText('Evaluation unavailable for this revision.');
  await expect(findings).not.toContainText('Evaluating');
  const fragment = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
    if (!raw) throw new Error('No saved record');
    const bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(raw).build));
    return btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
  });
  await page.goto(`/shared#b1.${fragment}`);
  await expect(page.getByTestId('overall-status')).toContainText('Evaluation unavailable');
  const sharedFindings = page.getByRole('region', { name: 'Findings' });
  await expect(sharedFindings).toContainText('Evaluation unavailable for this build.');
  await expect(sharedFindings).not.toContainText('Evaluating');
});
