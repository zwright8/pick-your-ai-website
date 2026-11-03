import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../../contracts/v1/examples/build.json', import.meta.url), 'utf8'),
);

async function installDelayedReads(page: Page) {
  await page.addInitScript(() => {
    const original = Blob.prototype.text;
    const pending = new Map<string, () => void>();
    Reflect.set(window, '__pendingImports', pending);
    Blob.prototype.text = async function () {
      const contents = await original.call(this);
      if (!(this instanceof File) || !this.name.startsWith('delayed-')) return contents;
      return new Promise<string>((resolve) => pending.set(this.name, () => resolve(contents)));
    };
  });
}

async function choose(page: Page, name: string, contents: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(contents),
  });
  if (name.startsWith('delayed-')) {
    await page.waitForFunction(
      (fileName) => Reflect.get(window, '__pendingImports')?.has(fileName),
      name,
    );
  }
}

async function release(page: Page, fileName: string) {
  await page.evaluate(async (name) => {
    const pending = Reflect.get(window, '__pendingImports') as Map<string, () => void>;
    const resolve = pending.get(name);
    if (!resolve) throw new Error(`Missing pending file ${name}`);
    resolve();
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  }, fileName);
}

for (const path of ['/builds', '/shared']) {
  test(`${path} keeps the most recently selected file when reads finish out of order`, async ({
    page,
  }) => {
    await installDelayedReads(page);
    await page.goto(path);
    await choose(page, 'delayed-old.json', JSON.stringify({ ...fixture, name: 'Older choice' }));
    await choose(page, 'delayed-new.json', JSON.stringify({ ...fixture, name: 'Newer choice' }));
    await release(page, 'delayed-new.json');
    if (path === '/builds') {
      await expect(page).toHaveURL(/\/builder$/);
      await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('Newer choice');
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Newer choice');
    }
    await release(page, 'delayed-old.json');
    if (path === '/builds') {
      await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('Newer choice');
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Newer choice');
    }
  });
}

test('a failed newer import prevents an older import from opening', async ({ page }) => {
  await installDelayedReads(page);
  await page.goto('/builds');
  await choose(page, 'delayed-old.json', JSON.stringify({ ...fixture, name: 'Older choice' }));
  await choose(page, 'delayed-new.json', '{invalid');
  await release(page, 'delayed-new.json');
  await expect(page.getByRole('alert')).toContainText('File is not valid JSON.');
  await release(page, 'delayed-old.json');
  await expect(page).toHaveURL(/\/builds$/);
  await expect(page.getByRole('alert')).toContainText('File is not valid JSON.');
});

test('closing a file preview cancels an earlier pending file read', async ({ page }) => {
  await installDelayedReads(page);
  await page.goto('/shared');
  await choose(page, 'first.json', JSON.stringify({ ...fixture, name: 'First preview' }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('First preview');
  await choose(page, 'delayed-old.json', JSON.stringify({ ...fixture, name: 'Pending preview' }));
  await page.getByRole('button', { name: 'Close file preview' }).click();
  await release(page, 'delayed-old.json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared build');
});

test('leaving My Builds prevents a pending import from changing the current page', async ({
  page,
}) => {
  await installDelayedReads(page);
  await page.goto('/builds');
  await choose(page, 'delayed-old.json', JSON.stringify({ ...fixture, name: 'Older choice' }));
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'About', exact: true })
    .click();
  await expect(page).toHaveURL(/\/about$/);
  await release(page, 'delayed-old.json');
  await expect(page).toHaveURL(/\/about$/);
});
