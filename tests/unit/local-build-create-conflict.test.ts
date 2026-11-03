// @vitest-environment node
import { expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

it('does not overwrite an existing or unreadable record when creating a build', async () => {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  const repo = new LocalBuildRepository(storage);
  const draft = createDraft(apiChat());
  await repo.save(draft, null);
  const key = `pyai.build.${draft.build.id}`;
  for (const existing of [storage.getItem(key), '']) {
    if (existing === null) throw new Error('Missing original record');
    storage.setItem(key, existing);
    const before = [...entries];
    const replacement = createDraft({ ...draft.build, name: 'Replacement' });
    await expect(repo.save(replacement, null)).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
    });
    expect([...entries]).toEqual(before);
  }
});
