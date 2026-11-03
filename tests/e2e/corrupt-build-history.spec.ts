import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('corrupt retained history is reported without changing the saved build', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Saved before corruption');
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
    const record = JSON.parse(raw);
    record.changes = [null];
    const corrupt = JSON.stringify(record);
    localStorage.setItem(key, corrupt);
    return { key, corrupt };
  });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Not saved:' })).toContainText(
    'The saved build could not be loaded. A new blank draft is open; stored data was not changed.',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.corrupt);
  await page.goto('/builds');
  await expect(page.getByRole('heading', { name: 'Unreadable saved build' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.corrupt);
  await expect(page.getByText(/prior history will not be included/)).toBeVisible();
  await page.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved before corruption (recovered)' }),
  ).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.corrupt);
  const copies = await page.evaluate((oldKey) => {
    const ids = JSON.parse(localStorage.getItem('pyai.builds.index') ?? '[]') as string[];
    return ids
      .filter((id) => `pyai.build.${id}` !== oldKey)
      .map((id) => {
        const raw = localStorage.getItem(`pyai.build.${id}`);
        if (!raw) throw new Error('Recovered record is missing');
        return JSON.parse(raw);
      });
  }, saved.key);
  expect(copies).toHaveLength(1);
  expect(copies[0].build.name).toBe('Saved before corruption (recovered)');
  expect(copies[0].build.revision).toBe(1);
  const original = JSON.parse(saved.corrupt).build;
  for (const field of ['selections', 'objectives', 'links', 'locks', 'policy']) {
    expect(copies[0].build[field]).toEqual(original[field]);
  }
  expect(copies[0].revisions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Saved before corruption (recovered)' }),
  ).toBeVisible();
});

test('an invalid current build cannot be recovered or overwritten', async ({ page }) => {
  const raw = JSON.stringify({ build: null, revisions: [], changes: [null] });
  await page.addInitScript((record) => {
    localStorage.setItem('pyai.builds.index', JSON.stringify(['build.broken']));
    localStorage.setItem('pyai.build.build.broken', record);
  }, raw);
  await page.goto('/builds');
  await page.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(page.getByRole('alert')).toContainText('The current build cannot be recovered');
  expect(await page.evaluate(() => localStorage.getItem('pyai.build.build.broken'))).toBe(raw);
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe(
    '["build.broken"]',
  );
});

test('a mismatched history head is reported and can be recovered as a copy', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Valid current head');
  await name.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const raw = id && localStorage.getItem(`pyai.build.${id}`);
        return raw ? (JSON.parse(raw) as { build: { name: string } }).build.name : null;
      }),
    )
    .toBe('Valid current head');
  const original = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId')!;
    const key = `pyai.build.${id}`;
    const record = JSON.parse(localStorage.getItem(key)!);
    record.revisions.at(-1).name = 'Incorrect history';
    const raw = JSON.stringify(record);
    localStorage.setItem(key, raw);
    return { key, raw };
  });
  await page.goto('/builds');
  await expect(page.getByRole('heading', { name: 'Unreadable saved build' })).toBeVisible();
  await page.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(page.getByRole('heading', { name: 'Valid current head (recovered)' })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), original.key)).toBe(original.raw);
});

for (const theme of ['light', 'dark']) {
  test(`recovery actions pass accessibility checks in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem('pyai.theme', selectedTheme);
      localStorage.setItem('pyai.builds.index', JSON.stringify(['build.broken']));
      localStorage.setItem('pyai.build.build.broken', '{broken');
    }, theme);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builds');
    const card = page.getByRole('article');
    await expect(card.getByRole('button', { name: 'Recover current build as copy' })).toBeVisible();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    const result = await new AxeBuilder({ page })
      .include('.saved-card')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });
}

test('a storage failure during recovery keeps the original record and reports the error', async ({
  page,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Recoverable build');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const before = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved record');
    const record = JSON.parse(raw);
    record.changes = [null];
    const corrupt = JSON.stringify(record);
    localStorage.setItem(key, corrupt);
    return { key, corrupt, index: localStorage.getItem('pyai.builds.index') };
  });
  await page.goto('/builds');
  await expect(page.getByRole('button', { name: 'Recover current build as copy' })).toBeVisible();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.'))
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser storage is full or unavailable');
  expect(await page.evaluate((key) => localStorage.getItem(key), before.key)).toBe(before.corrupt);
  expect(await page.evaluate(() => localStorage.getItem('pyai.builds.index'))).toBe(before.index);
});

test('a recovery ID collision does not overwrite the damaged original', async ({ page }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Original build');
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
    const record = JSON.parse(raw);
    record.changes = [null];
    const corrupt = JSON.stringify(record);
    localStorage.setItem(key, corrupt);
    return { id, key, corrupt };
  });
  await page.goto('/builds');
  await expect(page.getByRole('button', { name: 'Recover current build as copy' })).toBeVisible();
  await page.evaluate((id) => {
    const randomPrefix = id.replace('build.local.', '');
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => `${randomPrefix}-0000-4000-8000-000000000000`,
    });
  }, saved.id);
  await page.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not create a distinct recovery copy');
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.corrupt);
});

test('recovery does not overwrite a different unreadable record on ID collision', async ({
  page,
}) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Original build');
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
    const record = JSON.parse(raw);
    record.changes = [null];
    const corrupt = JSON.stringify(record);
    localStorage.setItem(key, corrupt);
    localStorage.setItem('pyai.builds.index', JSON.stringify([id, 'build.local.123456789abc']));
    localStorage.setItem('pyai.build.build.local.123456789abc', '');
    return { id, key, corrupt };
  });
  await page.goto('/builds');
  const originalCard = page
    .getByRole('article')
    .filter({ has: page.locator('code', { hasText: saved.id }) });
  await expect(
    originalCard.getByRole('button', { name: 'Recover current build as copy' }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => '12345678-9abc-4000-8000-000000000000',
    });
  });
  await originalCard.getByRole('button', { name: 'Recover current build as copy' }).click();
  await expect(originalCard.getByRole('alert')).toContainText('Saved build is not valid JSON');
  expect(await page.evaluate((key) => localStorage.getItem(key), saved.key)).toBe(saved.corrupt);
  expect(
    await page.evaluate(() => localStorage.getItem('pyai.build.build.local.123456789abc')),
  ).toBe('');
});
