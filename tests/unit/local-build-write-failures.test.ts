// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { commit, createDraft } from '../../src/domain/build';
import { NOW, apiChat } from './scenarios';

function storageFixture() {
  const entries = new Map<string, string>();
  let failKey: string | null = null;
  let failRemoveKey: string | null = null;
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (key === failKey) throw new Error('storage write failed');
      entries.set(key, value);
    },
    removeItem: (key) => {
      if (key === failRemoveKey) throw new Error('storage removal failed');
      entries.delete(key);
    },
  };
  return {
    entries,
    storage,
    failWritesTo: (key: string | null) => (failKey = key),
    failRemovalsOf: (key: string | null) => (failRemoveKey = key),
  };
}

const INDEX = 'pyai.builds.index';

describe('saved-build storage write failures', () => {
  it('does not create an unindexed record when creating a build and the index write fails', async () => {
    const { entries, storage, failWritesTo } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    failWritesTo(INDEX);

    await expect(repo.save(draft, null)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(entries.has(`pyai.build.${draft.build.id}`)).toBe(false);
    expect(entries.has(INDEX)).toBe(false);
  });

  it('keeps an existing build when deletion cannot update the index', async () => {
    const { entries, storage, failWritesTo } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const before = [...entries];
    failWritesTo(INDEX);

    await expect(repo.remove(draft.build.id)).rejects.toMatchObject({ kind: 'unsupported' });
    expect([...entries]).toEqual(before);
  });

  it('restores the original index when writing a newly indexed build fails', async () => {
    const { entries, storage, failWritesTo } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    const before = [...entries];
    failWritesTo(`pyai.build.${draft.build.id}`);

    await expect(repo.save(draft, null)).rejects.toMatchObject({ kind: 'unsupported' });
    expect([...entries]).toEqual(before);
  });

  it('restores the index when deleting a record fails', async () => {
    const { entries, storage, failRemovalsOf } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const before = [...entries];
    failRemovalsOf(`pyai.build.${draft.build.id}`);

    await expect(repo.remove(draft.build.id)).rejects.toMatchObject({ kind: 'unsupported' });
    expect([...entries]).toEqual(before);
  });

  it('can update an indexed build when the index cannot be rewritten', async () => {
    const { storage, failWritesTo } = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    failWritesTo(INDEX);
    const updated = commit(draft, (build) => build, 'Update', [], NOW);

    await expect(repo.save(updated, draft.build.revision)).resolves.toEqual(updated);
    expect((await repo.list())[0]?.revision).toBe(updated.build.revision);
  });

  it('reports when a failed save cannot restore the index', async () => {
    const entries = new Map<string, string>();
    let indexWrites = 0;
    const storage: KeyValueStorage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        if (key === INDEX && ++indexWrites === 2) throw new Error('index restore failed');
        if (key.startsWith('pyai.build.')) throw new Error('record write failed');
        entries.set(key, value);
      },
      removeItem: (key) => void entries.delete(key),
    };
    entries.set(INDEX, '[]');
    const repo = new LocalBuildRepository(storage);

    await expect(repo.save(createDraft(apiChat()), null)).rejects.toMatchObject({
      kind: 'unsupported',
      message: expect.stringContaining('could not be restored'),
    });
  });

  it('does not overwrite an index changed after the first write', async () => {
    const entries = new Map<string, string>();
    const concurrentIndex = '["build.concurrent"]';
    const storage: KeyValueStorage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        if (key.startsWith('pyai.build.')) {
          entries.set(INDEX, concurrentIndex);
          throw new Error('record write failed');
        }
        entries.set(key, value);
      },
      removeItem: (key) => void entries.delete(key),
    };
    const repo = new LocalBuildRepository(storage);

    await expect(repo.save(createDraft(apiChat()), null)).rejects.toMatchObject({
      kind: 'unsupported',
      message: expect.stringContaining('could not be restored'),
    });
    expect(entries.get(INDEX)).toBe(concurrentIndex);
  });
});
