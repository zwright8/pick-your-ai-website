import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('Markdown download keeps build-name markup as literal heading text', async ({
  page,
}, testInfo) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use this build' }).first().click();
  await waitForSavedRevision(page, 1);
  const name = page.getByRole('textbox', { name: 'Build name' });
  await name.fill('Research | [spec](https://example.com)');
  await name.press('Tab');
  await waitForSavedRevision(page, 2);
  await page.goto('/summary');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown' }).click();
  const download = await downloadPromise;
  await download.saveAs(testInfo.outputPath('exported-build.md'));
  const path = await download.path();
  if (!path) throw new Error('Missing Markdown download');
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const markdown = await readFile(path, 'utf8');
  expect(markdown).toContain('# Research \\| \\[spec\\](https\\://example.com)\n');
  expect(markdown).toContain('Demo components, prices and results are synthetic');
  expect(markdown).toContain('(synthetic)');
});
