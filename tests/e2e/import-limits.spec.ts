import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('an incomplete build explains JSON unavailability without copying an error as JSON', async ({
  page,
}) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'View JSON' }).click();
  const preview = page.getByRole('dialog', { name: 'Your build configuration' });
  await expect(preview.getByRole('alert')).toContainText('Add at least 2 components');
  await expect(preview.getByRole('button', { name: 'Copy JSON' })).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`JSON preview errors and warnings are accessible in ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      (selectedTheme) => localStorage.setItem('pyai.theme', selectedTheme),
      theme,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/builder');
    await page.getByRole('button', { name: 'View JSON' }).click();
    let dialog = page.getByRole('dialog', { name: 'Your build configuration' });
    await expect(dialog.getByRole('alert')).toBeVisible();
    let result = await new AxeBuilder({ page }).include('.json-preview-warning').analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.goto('/templates');
    await page.getByRole('button', { name: 'Use this build' }).first().click();
    await waitForSavedRevision(page, 1);
    await page.evaluate(() => {
      const id = localStorage.getItem('pyai.currentBuildId');
      const key = `pyai.build.${id}`;
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('Missing saved build');
      const record = JSON.parse(raw);
      record.build.extensions = { x_deep: JSON.parse('['.repeat(120) + '0' + ']'.repeat(120)) };
      for (const revision of record.revisions) revision.extensions = record.build.extensions;
      localStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload();
    await page.getByRole('button', { name: 'View JSON' }).click();
    dialog = page.getByRole('dialog', { name: 'Your build configuration' });
    await expect(dialog.getByRole('alert')).toContainText('cannot be re-imported');
    result = await new AxeBuilder({ page }).include('.json-preview-warning').analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
}

test('JSON copy reports when the browser does not expose a clipboard', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined }),
  );
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await page.getByRole('button', { name: 'View JSON' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Copy JSON' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copy was blocked by this browser.' }),
  ).toBeVisible();
});

for (const path of ['/builds', '/shared']) {
  test(`${path} rejects an oversized file before reading it`, async ({ page }) => {
    await page.addInitScript(() => {
      const text = Blob.prototype.text;
      Blob.prototype.text = function () {
        if (this instanceof File && this.name === 'oversized.json') {
          throw new Error('Oversized file was read');
        }
        return text.call(this);
      };
    });
    await page.goto(path);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'oversized.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(page.getByRole('alert')).toContainText('File is larger than 5 MB.');
  });

  test(`${path} reports an unreadable file`, async ({ page }) => {
    await page.addInitScript(() => {
      const text = Blob.prototype.text;
      Blob.prototype.text = function () {
        if (this instanceof File && this.name === 'unreadable.json') {
          return Promise.reject(new Error('Read failed'));
        }
        return text.call(this);
      };
    });
    await page.goto(path);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'unreadable.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await expect(page.getByRole('alert')).toContainText('Could not read the file.');
  });

  test(`${path} reports malformed metadata rather than failing silently`, async ({ page }) => {
    await page.goto(path);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'invalid-metadata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: { toString: null, valueOf: null } })),
    });
    await expect(page.getByRole('alert')).toContainText('Unsupported file format');
  });

  test(`${path} reports excessive nesting in a build file`, async ({ page }) => {
    const base = readFileSync(
      new URL('../../contracts/v1/examples/build.json', import.meta.url),
      'utf8',
    ).trim();
    const nested = '['.repeat(5000) + '0' + ']'.repeat(5000);
    const contents = `${base.slice(0, -1)},"extensions":{"x_deep":${nested}}}`;
    await page.goto(path);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'deep.json',
      mimeType: 'application/json',
      buffer: Buffer.from(contents),
    });
    await expect(page.getByRole('alert')).toContainText('Build data is nested too deeply');
  });
}

test('a shared link with malformed metadata shows an error', async ({ page }) => {
  const json = JSON.stringify({ format: { toString: null, valueOf: null } });
  const fragment = Buffer.from(json).toString('base64url');
  await page.goto(`/shared#b1.${fragment}`);
  await expect(page.getByText('Unsupported file format')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shared build', exact: true })).toBeVisible();
});

test('a shared link with excessive nesting shows an error', async ({ page }) => {
  const base = readFileSync(
    new URL('../../contracts/v1/examples/build.json', import.meta.url),
    'utf8',
  ).trim();
  const nested = '['.repeat(5000) + '0' + ']'.repeat(5000);
  const text = `${base.slice(0, -1)},"extensions":{"x_deep":${nested}}}`;
  await page.goto(`/shared#b1.${Buffer.from(text).toString('base64url')}`);
  await expect(page.getByText('Build data is nested too deeply')).toBeVisible();
});

test('a previously saved deep build can be backed up but not shared as an unusable link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const record = JSON.parse(raw);
    record.build.extensions = { x_deep: JSON.parse('['.repeat(120) + '0' + ']'.repeat(120)) };
    for (const revision of record.revisions) revision.extensions = record.build.extensions;
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.reload();
  await page.getByRole('button', { name: 'View JSON' }).click();
  const preview = page.getByRole('dialog', { name: 'Your build configuration' });
  await expect(preview.getByRole('alert')).toContainText('cannot be re-imported');
  await expect(preview.getByRole('alert')).toContainText('nested too deeply');
  await page.waitForTimeout(3300);
  await expect(preview.getByRole('alert')).toBeVisible();
  await preview.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.locator('.toast.visible')).toBeVisible();
  await expect(page.locator('.toast.visible')).toHaveText('Configuration JSON copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied).build.name).toBe('Provider-API support chat (demo)');
  await preview.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'nested too deeply to share' }),
  ).toBeVisible();
  const builderDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await builderDownload).suggestedFilename()).toMatch(/\.pickyour-ai\.json$/);
  const warning = page.getByRole('alert').filter({ hasText: 'cannot be re-imported' });
  await expect(warning).toContainText('nested too deeply');
  const builderBox = await page.locator('.export-warning').boundingBox();
  expect(builderBox).not.toBeNull();
  expect(builderBox && builderBox.y >= 0 && builderBox.y + builderBox.height <= 800).toBe(true);
  await page.waitForTimeout(3300);
  await expect(warning).toBeVisible();
  await page.mouse.move(0, 0);
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(350);
    const result = await new AxeBuilder({ page }).include('.export-warning').analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(warning).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss export warning' });
  await dismiss.focus();
  await dismiss.press('Enter');
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
  await page.goto('/summary');
  const summaryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  expect((await summaryDownload).suggestedFilename()).toMatch(/\.pickyour-ai\.json$/);
  const summaryWarning = page.getByRole('alert').filter({ hasText: 'cannot be re-imported' });
  await expect(summaryWarning).toContainText('nested too deeply');
  await page.waitForTimeout(3300);
  await expect(summaryWarning).toBeVisible();
  await page.mouse.move(0, 0);
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(350);
    const result = await new AxeBuilder({ page }).include('.export-warning').analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Dismiss export warning' }).click();
  await expect(summaryWarning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeFocused();
  await page.goto('/builds');
  const libraryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export JSON of/ }).click();
  expect((await libraryDownload).suggestedFilename()).toMatch(/\.pickyour-ai\.json$/);
  const libraryWarning = page.getByRole('alert').filter({ hasText: 'cannot be re-imported' });
  await expect(libraryWarning).toContainText('nested too deeply');
  const libraryBox = await page.locator('.export-warning').boundingBox();
  expect(libraryBox).not.toBeNull();
  expect(libraryBox && libraryBox.y >= 0 && libraryBox.y + libraryBox.height <= 800).toBe(true);
  await page.waitForTimeout(3300);
  await expect(libraryWarning).toBeVisible();
  await page.mouse.move(0, 0);
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(350);
    const result = await new AxeBuilder({ page }).include('.export-warning').analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Dismiss export warning' }).click();
  await expect(libraryWarning).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Export JSON of/ })).toBeFocused();
});

test('all JSON export actions compact whitespace to keep a large build importable', async ({
  page,
}) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const record = JSON.parse(raw);
    let nested: unknown = Array.from({ length: 45_000 }, () => 'x');
    for (let i = 0; i < 60; i++) nested = [nested];
    record.build.extensions = { x_nested: nested };
    for (const revision of record.revisions) revision.extensions = record.build.extensions;
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto('/builder');
  await page.getByRole('button', { name: 'View JSON' }).click();
  const preview = page.getByRole('dialog', { name: 'Your build configuration' });
  const json = await preview.locator('#jsonPreview').textContent();
  if (!json) throw new Error('Missing JSON preview');
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(json).not.toContain('\n  "format"');
  await expect(preview.getByRole('alert')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Close dialog' }).click();
  const downloads: string[] = [];
  for (const [route, label] of [
    ['/builder', 'Export'],
    ['/summary', 'Export JSON'],
    ['/builds', 'Export JSON of Provider-API support chat (demo)'],
  ]) {
    await page.goto(route);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error('Missing exported file');
    const bytes = await readFile(path);
    expect(bytes.byteLength).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(bytes.toString()).not.toContain('\n  "format"');
    await expect(page.getByRole('alert').filter({ hasText: 'cannot be re-imported' })).toHaveCount(
      0,
    );
    downloads.push(path);
  }
  for (const path of downloads) {
    await page.goto('/shared');
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Provider-API support chat (demo)',
    );
  }
});

test('shared preview opens a valid file at the 5 MB limit', async ({ page }) => {
  const build = JSON.parse(
    readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
  );
  build.extensions = { x_padding: '' };
  const size = Buffer.byteLength(JSON.stringify(build));
  build.extensions.x_padding = 'a'.repeat(5 * 1024 * 1024 - size);
  const buffer = Buffer.from(JSON.stringify(build));
  expect(buffer.byteLength).toBe(5 * 1024 * 1024);
  await page.goto('/shared');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'at-limit.json',
    mimeType: 'application/json',
    buffer,
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(build.name);
});

test('a build at the nesting limit can be imported, exported and shared', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const build = JSON.parse(
    readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
  );
  build.name = 'Nesting boundary build';
  const base = JSON.stringify(build);
  const nested = '['.repeat(98) + '0' + ']'.repeat(98);
  const text = `${base.slice(0, -1)},"extensions":{"x_deep":${nested}}}`;
  await page.goto('/builds');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'boundary.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue(build.name);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Missing exported file');
  await expect(page.getByRole('alert').filter({ hasText: 'cannot be re-imported' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.locator('.toast.visible')).toBeVisible();
  await expect(page.locator('.toast.visible')).toContainText('Share link copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(build.name);
  await page.goto('/shared');
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(build.name);
});

test('a build larger than the link limit can be exported and imported on both screens', async ({
  page,
}) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    if (!id) throw new Error('No current build');
    const key = `pyai.build.${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('No saved build');
    const record = JSON.parse(raw);
    record.build.extensions = { x_padding: '😀'.repeat((512 * 1024) / 4) };
    for (const revision of record.revisions) revision.extensions = record.build.extensions;
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'too large to share' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pickyour-ai\.json$/);
  const exportedFile = await download.path();
  expect(exportedFile).toBeTruthy();
  await expect(
    page.getByRole('status').filter({ hasText: 'Configuration exported' }),
  ).toBeVisible();
  await page.goto('/builds');
  const libraryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export JSON of/ }).click();
  expect((await libraryDownload).suggestedFilename()).toMatch(/\.pickyour-ai\.json$/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved build exported' })).toBeVisible();
  if (!exportedFile) throw new Error('Missing downloaded file');
  await page.goto('/shared');
  await page.locator('input[type="file"]').setInputFiles(exportedFile);
  await expect(
    page.getByRole('heading', { name: 'Provider-API support chat (demo)' }),
  ).toBeVisible();
  await page.goto('/builds');
  await page.locator('input[type="file"]').setInputFiles(exportedFile);
  await expect(page).toHaveURL(/\/builder$/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
        return raw ? JSON.parse(raw).build.extensions?.x_padding?.length : null;
      }),
    )
    .toBe((512 * 1024) / 2);
});
