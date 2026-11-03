import { expect, test } from '@playwright/test';

test('removing a primary promotes an enabled selection even after a disabled one', async ({
  page,
}) => {
  for (let count = 1; count <= 3; count++) {
    await page.goto(`/catalog/tool?show=all${count > 1 ? '&add=1' : ''}`);
    const row = page.getByRole('row', { name: /Demo Web Search Tool/ });
    await row.getByRole('button', { name: /Add|In stack/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const id = localStorage.getItem('pyai.currentBuildId');
          const raw = id && localStorage.getItem(`pyai.build.${id}`);
          if (!raw) return 0;
          const record = JSON.parse(raw) as { build: { selections: { kind: string }[] } };
          return record.build.selections.filter((selection) => selection.kind === 'tool').length;
        }),
      )
      .toBe(count);
  }
  await page.goto('/builder');
  const rows = page.locator('.pt tbody tr[data-kind="tool"]');
  await expect(rows).toHaveCount(3);
  await rows
    .nth(1)
    .getByRole('button', { name: /^Disable / })
    .click();
  await expect(rows.nth(1)).toHaveClass(/is-disabled/);
  await rows
    .nth(0)
    .getByRole('button', { name: /^Remove / })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const raw = id && localStorage.getItem(`pyai.build.${id}`);
        if (!raw) return null;
        const record = JSON.parse(raw) as {
          build: { selections: { kind: string; role: string; enabled: boolean }[] };
        };
        const tools = record.build.selections.filter((selection) => selection.kind === 'tool');
        return tools.length === 2 ? tools.find((selection) => selection.role === 'primary') : null;
      }),
    )
    .toMatchObject({ enabled: true });
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveClass(/is-disabled/);
  await expect(rows.last()).not.toHaveClass(/is-disabled/);
});
