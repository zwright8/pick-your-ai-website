import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a corrupt saved-build index is reported without changing stored data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pyai.builds.index', '{broken');
    localStorage.setItem('pyai.build.synthetic', 'sentinel');
  });
  await page.goto('/builds');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load saved builds');
  await expect(alert).toContainText('The saved-build index is unreadable');
  await expect(alert).toContainText('Stored builds have not been changed');
  await expect(page.getByRole('heading', { name: 'Your library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save a copy' })).toBeDisabled();
  expect(
    await page.evaluate(() => [
      localStorage.getItem('pyai.builds.index'),
      localStorage.getItem('pyai.build.synthetic'),
    ]),
  ).toEqual(['{broken', 'sentinel']);
});

test('a damaged index can be rebuilt from saved records after explicit confirmation', async ({
  page,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Build to recover');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const saved = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved record');
    localStorage.setItem('pyai.build.empty', '');
    localStorage.setItem('pyai.builds.index', '{broken');
    return { key, raw };
  });
  await page.goto('/builds');
  await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    page.getByRole('button', { name: 'Find saved builds in this browser' }),
  ).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe('{broken');
  await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
  await expect(
    page.getByRole('group', { name: 'Confirm saved-build index recovery' }),
  ).toContainText('build records are not changed');
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe('{broken');
  await page.getByRole('button', { name: 'Find builds', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Build to recover.*current/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unreadable saved build' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index.backup.1'))).toBe(
    '{broken',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.raw);
  expect(await page.evaluate(() => localStorage.getItem('pyai.build.empty'))).toBe('');
});

test('the empty library can find a build whose index is missing', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Unindexed build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  await page.evaluate(() => localStorage.removeItem('pyai.builds.index'));
  await page.goto('/builds');
  await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
  await page.getByRole('button', { name: 'Find builds', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Unindexed build.*current/ })).toBeVisible();
});

test('a nonempty library can recover an unindexed build without changing records', async ({
  page,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Existing build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const before = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const index = localStorage.getItem('pyai.builds.index');
    if (!id || !index) throw new Error('No saved build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved record');
    const record = JSON.parse(raw);
    record.build.id = 'build.orphan';
    record.build.name = 'Recovered orphan';
    for (const revision of record.revisions) {
      revision.id = 'build.orphan';
      revision.name = 'Recovered orphan';
    }
    const orphan = JSON.stringify(record);
    localStorage.setItem('pyai.build.build.orphan', orphan);
    return { key, raw, index, orphan };
  });
  await page.goto('/builds');
  await expect(page.getByRole('heading', { name: /Existing build.*current/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recovered orphan' })).toHaveCount(0);
  await page.getByText('Missing a saved build?').click();
  await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
  await page.getByRole('button', { name: 'Find builds', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recovered orphan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Existing build.*current/ })).toBeVisible();
  const after = await page.evaluate(
    (key) => ({
      backup: localStorage.getItem('pyai.builds.index.backup.1'),
      index: localStorage.getItem('pyai.builds.index'),
      raw: localStorage.getItem(key),
      orphan: localStorage.getItem('pyai.build.build.orphan'),
    }),
    before.key,
  );
  expect(after.backup).toBe(before.index);
  expect(JSON.parse(after.index ?? '')).toEqual([...JSON.parse(before.index), 'build.orphan']);
  expect(after.raw).toBe(before.raw);
  expect(after.orphan).toBe(before.orphan);
});

test('an index backup failure is reported without replacing the damaged index', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('pyai.builds.index', '{broken');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.builds.index.backup.'))
        throw new DOMException('Storage full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builds');
  await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
  await page.getByRole('button', { name: 'Find builds', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Confirm saved-build index recovery' }).getByRole('alert'),
  ).toContainText('index was not rebuilt');
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe('{broken');
});

for (const theme of ['light', 'dark']) {
  test(`index recovery confirmation is accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('pyai.theme', selectedTheme);
      localStorage.setItem('pyai.builds.index', '{broken');
    }, theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builds');
    await page.getByRole('button', { name: 'Find saved builds in this browser' }).click();
    const group = page.getByRole('group', { name: 'Confirm saved-build index recovery' });
    await expect(group).toBeVisible();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    const result = await new AxeBuilder({ page })
      .include('[aria-label="Confirm saved-build index recovery"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });
}
