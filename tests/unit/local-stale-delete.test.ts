import { expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

function fixture() {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  return { entries, storage, repo: new LocalBuildRepository(storage) };
}

it('preserves a newer revision when a stale delete is confirmed', async () => {
  const { entries, storage, repo } = fixture();
  const original = createDraft(apiChat());
  await repo.save(original, null);
  const summary = (await repo.list())[0]!;
  const updated = createDraft({ ...original.build, revision: original.build.revision + 1 });
  await new LocalBuildRepository(storage).save(updated, original.build.revision);
  const before = [...entries];
  await expect(repo.remove(summary.id, summary.deleteToken)).rejects.toMatchObject({
    kind: 'conflict',
    message: expect.stringContaining('changed'),
  });
  expect([...entries]).toEqual(before);
});

it('does not delete a changed unreadable record using an older confirmation', async () => {
  const { entries, repo } = fixture();
  entries.set('pyai.builds.index', '["build.broken"]');
  entries.set('pyai.build.build.broken', '{first');
  const summary = (await repo.list())[0]!;
  entries.set('pyai.build.build.broken', '{different');
  const before = [...entries];
  await expect(repo.remove(summary.id, summary.deleteToken)).rejects.toMatchObject({
    kind: 'conflict',
  });
  expect([...entries]).toEqual(before);
});

it('deletes an unchanged record after confirmation', async () => {
  const { repo } = fixture();
  const draft = createDraft(apiChat());
  await repo.save(draft, null);
  const summary = (await repo.list())[0]!;
  await expect(repo.remove(summary.id, summary.deleteToken)).resolves.toBeUndefined();
  expect(await repo.list()).toEqual([]);
});

it('restores the index if the record changes during deletion', async () => {
  const entries = new Map<string, string>();
  let changeOnIndexWrite = false;
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
      if (key === 'pyai.builds.index' && changeOnIndexWrite) {
        changeOnIndexWrite = false;
        entries.set('pyai.build.build.broken', '{newer');
      }
    },
    removeItem: (key) => void entries.delete(key),
  };
  entries.set('pyai.builds.index', '["build.broken"]');
  entries.set('pyai.build.build.broken', '{original');
  const repo = new LocalBuildRepository(storage);
  const summary = (await repo.list())[0]!;
  changeOnIndexWrite = true;
  await expect(repo.remove(summary.id, summary.deleteToken)).rejects.toMatchObject({
    kind: 'conflict',
  });
  expect(entries.get('pyai.builds.index')).toBe('["build.broken"]');
  expect(entries.get('pyai.build.build.broken')).toBe('{newer');
});
