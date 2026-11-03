import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('editing one objective preserves untouched region and absent policy', async ({ page }) => {
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
      build: { objectives: { region: string }; policy?: unknown };
      revisions: { objectives: { region: string }; policy?: unknown }[];
    };
    for (const snapshot of [record.build, ...record.revisions]) {
      snapshot.objectives.region = '  region with spaces  ';
      delete snapshot.policy;
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  await expect(page.getByLabel('Region / residency')).toHaveValue('  region with spaces  ');
  await expect(page.getByRole('textbox', { name: 'Monthly budget' })).toHaveAccessibleDescription(
    /only with a cost policy/i,
  );
  await page.getByRole('textbox', { name: 'Requests per day' }).fill('1234');
  await page.getByRole('button', { name: 'Apply objectives' }).click();
  await waitForSavedRevision(page, 2);
  const saved = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
    if (!raw) throw new Error('Missing saved build');
    const record = JSON.parse(raw) as {
      build: { objectives: { region: string; requests_per_day: number }; policy?: unknown };
    };
    return {
      region: record.build.objectives.region,
      requests: record.build.objectives.requests_per_day,
      hasPolicy: Object.hasOwn(record.build, 'policy'),
    };
  });
  expect(saved).toEqual({ region: '  region with spaces  ', requests: 1234, hasPolicy: false });
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Objectives and policy' }).click();
  await expect(page.getByLabel('Region / residency')).toHaveValue('  region with spaces  ');
});
