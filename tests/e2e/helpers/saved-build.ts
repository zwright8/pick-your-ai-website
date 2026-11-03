import { expect, type Page } from '@playwright/test';

async function savedHead(page: Page) {
  return page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const raw = id ? localStorage.getItem(`pyai.build.${id}`) : null;
    return raw ? (JSON.parse(raw) as { build: { name: string; revision: number } }).build : null;
  });
}

export async function waitForSavedRevision(page: Page, revision: number) {
  await expect.poll(async () => (await savedHead(page))?.revision).toBe(revision);
}

export async function waitForSavedName(page: Page, name: string) {
  await expect.poll(async () => (await savedHead(page))?.name).toBe(name);
}
