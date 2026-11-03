// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

function storageFixture() {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  return { entries, storage };
}

describe('corrupt saved-build index', () => {
  it('orders saved builds by their actual timestamps rather than offset text', async () => {
    const { storage } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const base = apiChat();
    const older = createDraft({
      ...base,
      id: 'build.older',
      updated_at: '2026-10-20T00:30:00+02:00',
    });
    const newer = createDraft({ ...base, id: 'build.newer', updated_at: '2026-10-19T23:45:00Z' });
    await repo.save(older, null);
    await repo.save(newer, null);
    expect((await repo.list()).map((entry) => entry.id)).toEqual(['build.newer', 'build.older']);
  });
  it('lists an indexed record once when an index contains duplicate IDs', async () => {
    const { entries, storage } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const index = JSON.stringify([draft.build.id, draft.build.id]);
    storage.setItem('pyai.builds.index', index);
    const before = [...entries];
    expect((await repo.list()).map((entry) => entry.id)).toEqual([draft.build.id]);
    expect([...entries]).toEqual(before);
  });

  it.each(['{broken', '{}', '["build.saved", 5]'])(
    'reports the problem without changing stored records when the index is %s',
    async (badIndex) => {
      const { entries, storage } = storageFixture();
      const repo = new LocalBuildRepository(storage);
      const draft = createDraft(apiChat());
      await repo.save(draft, null);
      storage.setItem('pyai.builds.index', badIndex);
      const before = [...entries];

      await expect(repo.list()).rejects.toMatchObject({ kind: 'malformed' });
      await expect(repo.save(draft, draft.build.revision)).rejects.toMatchObject({
        kind: 'malformed',
      });
      await expect(repo.remove(draft.build.id)).rejects.toMatchObject({ kind: 'malformed' });
      expect([...entries]).toEqual(before);
    },
  );
});
