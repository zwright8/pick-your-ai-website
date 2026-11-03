import { expect, test } from '@playwright/test';

test('a second tab waits for the build storage lock before saving', async ({ page, context }) => {
  await page.goto('/builder');
  const firstName = page.getByRole('textbox', { name: 'Build name' });
  await firstName.fill('Before lock');
  await firstName.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const id = await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'));
  if (!id) throw new Error('Missing saved build ID');
  const second = await context.newPage();
  await second.goto('/builder');
  const secondName = second.getByRole('textbox', { name: 'Build name' });
  await expect(secondName).toHaveValue('Before lock');
  await page.evaluate(
    () =>
      new Promise<void>((ready) => {
        void navigator.locks.request(
          'pickyour-ai.local-builds.v1',
          () =>
            new Promise<void>((release) => {
              Reflect.set(window, '__releaseBuildLock', release);
              ready();
            }),
        );
      }),
  );
  await secondName.fill('After lock');
  await secondName.press('Tab');
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const locks = await navigator.locks.query();
          return (
            locks.pending?.some((lock) => lock.name === 'pickyour-ai.local-builds.v1') ?? false
          );
        }),
      { timeout: 3000 },
    )
    .toBe(true);
  const stored = await page.evaluate(
    (buildId) => localStorage.getItem(`pyai.build.${buildId}`),
    id,
  );
  expect(stored).toContain('Before lock');
  const warning = second.waitForEvent('dialog', { timeout: 3000 });
  const reload = second.evaluate(() => window.location.reload());
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(secondName).toHaveValue('After lock');
  await page.evaluate(() => Reflect.get(window, '__releaseBuildLock')());
  await expect
    .poll(() => page.evaluate((buildId) => localStorage.getItem(`pyai.build.${buildId}`), id))
    .toContain('After lock');
  await second.reload();
  await expect(secondName).toHaveValue('After lock');
});

test('simultaneous new builds in separate tabs keep both library entries', async ({
  page,
  context,
}) => {
  await page.goto('/builder');
  const firstName = page.getByRole('textbox', { name: 'Build name' });
  await firstName.fill('Original build');
  await firstName.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const second = await context.newPage();
  const third = await context.newPage();
  await Promise.all([second.goto('/builder'), third.goto('/builder')]);
  await expect(second.getByRole('textbox', { name: 'Build name' })).toHaveValue('Original build');
  await expect(third.getByRole('textbox', { name: 'Build name' })).toHaveValue('Original build');
  await page.evaluate(
    () =>
      new Promise<void>((ready) => {
        void navigator.locks.request(
          'pickyour-ai.local-builds.v1',
          () =>
            new Promise<void>((release) => {
              Reflect.set(window, '__releaseBuildLock', release);
              ready();
            }),
        );
      }),
  );
  await Promise.all([
    second.getByRole('button', { name: 'New', exact: true }).click(),
    third.getByRole('button', { name: 'New', exact: true }).click(),
  ]);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const locks = await navigator.locks.query();
        return (
          locks.pending?.filter((lock) => lock.name === 'pickyour-ai.local-builds.v1').length ?? 0
        );
      }),
    )
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => Reflect.get(window, '__releaseBuildLock')());
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ids = JSON.parse(localStorage.getItem('pyai.builds.index') ?? '[]') as string[];
        return ids.filter((id) => localStorage.getItem(`pyai.build.${id}`) !== null).length;
      }),
    )
    .toBe(3);
});

test('deletion waits for the same storage lock', async ({ page, context }) => {
  await page.goto('/builder');
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Delete after lock');
  await name.press('Tab');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pyai.currentBuildId')))
    .toBeTruthy();
  const id = await page.evaluate(() => localStorage.getItem('pyai.currentBuildId'));
  if (!id) throw new Error('Missing saved build ID');
  const other = await context.newPage();
  await other.goto('/builds');
  const card = other.getByRole('article').filter({ hasText: 'Delete after lock' });
  await card.getByRole('button', { name: 'Delete Delete after lock' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((ready) => {
        void navigator.locks.request(
          'pickyour-ai.local-builds.v1',
          () =>
            new Promise<void>((release) => {
              Reflect.set(window, '__releaseBuildLock', release);
              ready();
            }),
        );
      }),
  );
  await card.getByRole('button', { name: 'Yes, delete' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const locks = await navigator.locks.query();
        return locks.pending?.some((lock) => lock.name === 'pickyour-ai.local-builds.v1') ?? false;
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate((buildId) => localStorage.getItem(`pyai.build.${buildId}`), id),
  ).not.toBeNull();
  await page.evaluate(() => Reflect.get(window, '__releaseBuildLock')());
  await expect
    .poll(() => page.evaluate((buildId) => localStorage.getItem(`pyai.build.${buildId}`), id))
    .toBeNull();
});
