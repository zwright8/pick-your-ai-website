import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

const leapSecond = '2016-12-31T23:59:60Z';

test('shared previews preserve a contract-valid leap-second timestamp', async ({ page }) => {
  const build = JSON.parse(
    readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
  );
  build.updated_at = leapSecond;
  await page.goto(`/shared#b1.${Buffer.from(JSON.stringify(build)).toString('base64url')}`);
  await expect(page.locator(`time[datetime="${leapSecond}"]`)).toHaveText(leapSecond);
  await expect(page.getByText('Invalid Date')).toHaveCount(0);
});

test('saved cards, summaries and history preserve recorded leap seconds', async ({ page }) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate((timestamp) => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const record = JSON.parse(raw);
    record.build.updated_at = timestamp;
    record.revisions[record.revisions.length - 1] = structuredClone(record.build);
    record.changes[record.changes.length - 1].at = timestamp;
    localStorage.setItem(key, JSON.stringify(record));
  }, leapSecond);
  await page.goto('/builds');
  await expect(page.getByRole('article').first()).toContainText(`Edited ${leapSecond}`);
  await page.goto('/summary');
  await expect(page.locator(`time[datetime="${leapSecond}"]`)).toHaveCount(2);
  for (const time of await page.locator(`time[datetime="${leapSecond}"]`).all()) {
    await expect(time).toHaveText(leapSecond);
  }
  await page.goto('/builder');
  await page.locator('summary').filter({ hasText: 'Revision history' }).click();
  await expect(page.locator(`time[datetime="${leapSecond}"]`)).toHaveText(leapSecond);
  await expect(page.getByText('Invalid Date')).toHaveCount(0);
});

test('the library orders saved builds by instant across time-zone offsets', async ({ page }) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const old = JSON.parse(raw);
    old.build.name = 'Older instant';
    old.build.updated_at = '2026-10-20T00:30:00+02:00';
    old.revisions[old.revisions.length - 1] = structuredClone(old.build);
    const recent = structuredClone(old);
    recent.build.id = 'build.newer';
    recent.build.name = 'Newer instant';
    recent.build.updated_at = '2026-10-19T23:45:00Z';
    for (const revision of recent.revisions) revision.id = recent.build.id;
    recent.revisions[recent.revisions.length - 1] = structuredClone(recent.build);
    localStorage.setItem(key, JSON.stringify(old));
    localStorage.setItem('pyai.build.build.newer', JSON.stringify(recent));
    localStorage.setItem('pyai.builds.index', JSON.stringify([id, recent.build.id]));
  });
  await page.goto('/builds');
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Newer instant');
  await expect(cards.nth(1)).toContainText('Older instant');
});
