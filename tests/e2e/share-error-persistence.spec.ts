import { expect, test } from '@playwright/test';
import { waitForSavedRevision } from './helpers/saved-build';

test('a failed share stays visible until dismissed', async ({ page }) => {
  await page.goto('/builder');
  const share = page.getByRole('button', { name: 'Copy share link' });
  await share.click();
  const warning = page.getByRole('alert').filter({ hasText: 'Add at least 2 components' });
  await expect(warning).toBeVisible();
  const firstAlert = await warning.elementHandle();
  if (!firstAlert) throw new Error('Missing sharing alert');
  await share.click();
  await expect.poll(() => firstAlert.evaluate((element) => element.isConnected)).toBe(false);
  await expect(warning).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss sharing warning' }).click();
  await expect(warning).toHaveCount(0);
  await expect(share).toBeFocused();
});

test('starting another build clears the previous build’s share failure', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Add at least 2 components' });
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(warning).toHaveCount(0);
});

test('a later successful share clears a clipboard failure', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
  });
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  const share = page.getByRole('button', { name: 'Copy share link' });
  await share.click();
  const warning = page.getByRole('alert').filter({ hasText: 'Could not copy the link' });
  await expect(warning).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await share.click();
  await expect(warning).toHaveCount(0);
  await expect(page.locator('.toast.visible')).toContainText('Share link copied');
});

test('dismissing an old warning does not hide a pending retry result', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          if (++calls === 1) return Promise.reject(new Error('blocked'));
          return new Promise<void>((resolve) => {
            document.addEventListener('finish-share-retry', () => resolve(), { once: true });
          });
        },
      },
    });
  });
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  const share = page.getByRole('button', { name: 'Copy share link' });
  await share.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not copy the link' }),
  ).toBeVisible();
  await share.click();
  await page.getByRole('button', { name: 'Dismiss sharing warning' }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('finish-share-retry')));
  await expect(page.locator('.toast.visible')).toContainText('Share link copied');
});

test('an older clipboard success cannot dismiss a newer failure', async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          if (++calls > 1) return Promise.reject(new Error('blocked'));
          return new Promise<void>((resolve) => {
            document.addEventListener('finish-older-share', () => resolve(), { once: true });
          });
        },
      },
    });
  });
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  const share = page.getByRole('button', { name: 'Copy share link' });
  await share.click();
  await share.click();
  const warning = page.getByRole('alert').filter({ hasText: 'Could not copy the link' });
  await expect(warning).toBeVisible();
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('finish-older-share'));
    await Promise.resolve();
  });
  await expect(warning).toBeVisible();
});

test('a late clipboard failure is not attached to a different build', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((_resolve, reject) => {
            document.addEventListener('reject-older-share', () => reject(new Error('blocked')), {
              once: true,
            });
          }),
      },
    });
  });
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: 'Use this build' })
    .click();
  await waitForSavedRevision(page, 1);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Build name' })).toHaveValue('Untitled AI stack');
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('reject-older-share'));
    await Promise.resolve();
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not copy the link' })).toHaveCount(
    0,
  );
});
