// @vitest-environment node
import { expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

it('treats a record whose embedded ID differs from its key as unreadable', async () => {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  const repo = new LocalBuildRepository(storage);
  const draft = createDraft(apiChat());
  await repo.save(draft, null);
  const realKey = `pyai.build.${draft.build.id}`;
  const real = storage.getItem(realKey);
  if (real === null) throw new Error('Missing original record');
  storage.setItem('pyai.build.build.mislabeled', real);
  storage.setItem('pyai.builds.index', JSON.stringify(['build.mislabeled', draft.build.id]));

  const items = await repo.list();
  expect(items.find((item) => item.id === 'build.mislabeled')?.name).toBe(
    '(unreadable saved build)',
  );
  expect(items.find((item) => item.id === draft.build.id)?.name).toBe(draft.build.name);
  await expect(repo.get('build.mislabeled')).rejects.toMatchObject({ kind: 'malformed' });

  const update = createDraft({
    ...draft.build,
    id: 'build.mislabeled',
    revision: draft.build.revision + 1,
  });
  await expect(repo.save(update, draft.build.revision)).rejects.toMatchObject({
    kind: 'malformed',
  });
  expect(storage.getItem('pyai.build.build.mislabeled')).toBe(real);

  await repo.remove('build.mislabeled');
  expect(storage.getItem(realKey)).toBe(real);
  expect((await repo.list()).map((item) => item.id)).toEqual([draft.build.id]);
});
