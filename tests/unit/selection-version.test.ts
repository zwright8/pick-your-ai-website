import { afterEach, expect, it, vi } from 'vitest';
import { confirmVersionReplacement } from '../../src/lib/selection-version';
import { apiChat, item } from './scenarios';

afterEach(() => vi.restoreAllMocks());

it('warns when a workload version change may update objectives', () => {
  const workload = item('workload', 'support-chat');
  const selection = apiChat().selections.find((entry) => entry.kind === 'workload');
  if (!selection) throw new Error('Missing workload selection');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(
    confirmVersionReplacement({ ...selection, catalog_item_version: 'older-version' }, workload),
  ).toBe(false);
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('may also update workload objectives'),
  );
});
