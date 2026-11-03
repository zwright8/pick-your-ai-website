// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

function fixture() {
  const entries = new Map<string, string>();
  let failWrites = false;
  const storage: KeyValueStorage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('storage full');
      entries.set(key, value);
    },
    removeItem: (key) => void entries.delete(key),
  };
  return { entries, storage, blockWrites: () => (failWrites = true) };
}

describe('saved-build index recovery', () => {
  it('backs up a damaged index and finds records without changing their contents', async () => {
    const { storage } = fixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const key = `pyai.build.${draft.build.id}`;
    const record = storage.getItem(key);
    storage.setItem('pyai.build.extra', '');
    storage.setItem('pyai.builds.index', '{broken');

    await expect(repo.rebuildIndex()).resolves.toBe(2);
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe('{broken');
    expect(storage.getItem(key)).toBe(record);
    expect(storage.getItem('pyai.build.extra')).toBe('');
    expect((await repo.list()).map((item) => item.id).sort()).toEqual(
      [draft.build.id, 'extra'].sort(),
    );
  });

  it('finds records when the index is missing', async () => {
    const { storage } = fixture();
    const repo = new LocalBuildRepository(storage);
    storage.setItem('pyai.build.orphan', '');
    await expect(repo.rebuildIndex()).resolves.toBe(1);
    expect(storage.getItem('pyai.builds.index')).toBe('["orphan"]');
  });

  it('leaves a valid nonempty index unchanged when no records are missing', async () => {
    const { storage } = fixture();
    const repo = new LocalBuildRepository(storage);
    storage.setItem('pyai.builds.index', '["existing"]');
    await expect(repo.rebuildIndex()).resolves.toBe(0);
    expect(storage.getItem('pyai.builds.index')).toBe('["existing"]');
    expect(storage.getItem('pyai.builds.index.backup.1')).toBeNull();
  });

  it('preserves a valid index and adds unindexed records with a backup', async () => {
    const { storage } = fixture();
    const repo = new LocalBuildRepository(storage);
    const first = createDraft({ ...apiChat(), id: 'build.first', name: 'First' });
    const second = createDraft({ ...apiChat(), id: 'build.second', name: 'Second' });
    await repo.save(first, null);
    await repo.save(second, null);
    const original = '["build.first","build.missing"]';
    storage.setItem('pyai.builds.index', original);
    const firstRaw = storage.getItem('pyai.build.build.first');
    const secondRaw = storage.getItem('pyai.build.build.second');
    expect((await repo.list()).map((entry) => entry.id)).toEqual(['build.first']);
    await expect(repo.rebuildIndex()).resolves.toBe(2);
    expect(JSON.parse(storage.getItem('pyai.builds.index') ?? '')).toEqual([
      'build.first',
      'build.missing',
      'build.second',
    ]);
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe(original);
    expect(storage.getItem('pyai.build.build.first')).toBe(firstRaw);
    expect(storage.getItem('pyai.build.build.second')).toBe(secondRaw);
    expect((await repo.list()).map((entry) => entry.id).sort()).toEqual([
      'build.first',
      'build.second',
    ]);
  });

  it('leaves a damaged index untouched when backup storage fails', async () => {
    const { storage, blockWrites } = fixture();
    const repo = new LocalBuildRepository(storage);
    storage.setItem('pyai.builds.index', '{broken');
    blockWrites();
    await expect(repo.rebuildIndex()).rejects.toMatchObject({ kind: 'unsupported' });
    expect(storage.getItem('pyai.builds.index')).toBe('{broken');
  });

  it('keeps earlier backups and writes a new backup under a distinct key', async () => {
    const { storage } = fixture();
    const repo = new LocalBuildRepository(storage);
    storage.setItem('pyai.builds.index.backup.1', 'older backup');
    storage.setItem('pyai.builds.index', '{broken');
    await expect(repo.rebuildIndex()).resolves.toBe(0);
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe('older backup');
    expect(storage.getItem('pyai.builds.index.backup.2')).toBe('{broken');
  });

  it('stops if storage keys change during the scan', async () => {
    const entries = new Map<string, string>([
      ['pyai.builds.index', '{broken'],
      ['pyai.build.one', 'x'],
    ]);
    let calls = 0;
    const storage: KeyValueStorage = {
      get length() {
        return entries.size;
      },
      key: (index) => {
        calls++;
        if (calls === 3) {
          entries.delete('pyai.build.one');
          entries.set('pyai.build.two', 'y');
        }
        return [...entries.keys()][index] ?? null;
      },
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => void entries.set(key, value),
      removeItem: (key) => void entries.delete(key),
    };
    const repo = new LocalBuildRepository(storage);
    await expect(repo.rebuildIndex()).rejects.toMatchObject({ kind: 'conflict' });
    expect(storage.getItem('pyai.builds.index')).toBe('{broken');
    expect(storage.getItem('pyai.builds.index.backup.1')).toBeNull();
  });

  it('retains the original index and backup if the replacement write fails', async () => {
    const { entries, storage } = fixture();
    storage.setItem('pyai.builds.index', '{broken');
    const originalSetItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === 'pyai.builds.index') throw new Error('storage full');
      originalSetItem(key, value);
    };
    const repo = new LocalBuildRepository(storage);
    await expect(repo.rebuildIndex()).rejects.toMatchObject({ kind: 'unsupported' });
    expect(entries.get('pyai.builds.index')).toBe('{broken');
    expect(entries.get('pyai.builds.index.backup.1')).toBe('{broken');
  });

  it('does not overwrite an index changed while its backup was written', async () => {
    const { entries, storage } = fixture();
    storage.setItem('pyai.builds.index', '{broken');
    const originalSetItem = storage.setItem;
    storage.setItem = (key, value) => {
      originalSetItem(key, value);
      if (key === 'pyai.builds.index.backup.1') entries.set('pyai.builds.index', '["other-tab"]');
    };
    const repo = new LocalBuildRepository(storage);
    await expect(repo.rebuildIndex()).rejects.toMatchObject({ kind: 'conflict' });
    expect(storage.getItem('pyai.builds.index')).toBe('["other-tab"]');
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe('{broken');
  });

  it('does not overwrite a valid index changed while its backup was written', async () => {
    const { entries, storage } = fixture();
    const original = '["existing"]';
    storage.setItem('pyai.builds.index', original);
    storage.setItem('pyai.build.orphan', 'record');
    const originalSetItem = storage.setItem;
    storage.setItem = (key, value) => {
      originalSetItem(key, value);
      if (key === 'pyai.builds.index.backup.1') entries.set('pyai.builds.index', '["other-tab"]');
    };
    await expect(new LocalBuildRepository(storage).rebuildIndex()).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect(storage.getItem('pyai.builds.index')).toBe('["other-tab"]');
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe(original);
  });

  it('stops if a build record appears while the backup is written', async () => {
    const { entries, storage } = fixture();
    storage.setItem('pyai.builds.index', '{broken');
    const originalSetItem = storage.setItem;
    storage.setItem = (key, value) => {
      originalSetItem(key, value);
      if (key === 'pyai.builds.index.backup.1') entries.set('pyai.build.new', 'record');
    };
    const repo = new LocalBuildRepository(storage);
    await expect(repo.rebuildIndex()).rejects.toMatchObject({ kind: 'conflict' });
    expect(storage.getItem('pyai.builds.index')).toBe('{broken');
    expect(storage.getItem('pyai.build.new')).toBe('record');
    expect(storage.getItem('pyai.builds.index.backup.1')).toBe('{broken');
  });
});
