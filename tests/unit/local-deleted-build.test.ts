// @vitest-environment node
import { expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

it('rejects a stale save after the build was deleted', async () => {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  const repo = new LocalBuildRepository(storage);
  const draft = createDraft(apiChat());
  await repo.save(draft, null);
  await repo.remove(draft.build.id);
  const before = [...entries];
  const next = createDraft({ ...draft.build, revision: draft.build.revision + 1 });

  await expect(repo.save(next, draft.build.revision)).rejects.toMatchObject({
    kind: 'conflict',
    status: 409,
  });
  expect([...entries]).toEqual(before);
  expect(await repo.list()).toEqual([]);
});
