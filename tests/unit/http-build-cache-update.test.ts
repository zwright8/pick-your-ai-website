import { expect, it, vi } from 'vitest';
import { ContractHttpClient } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

it('updates an existing local cache after a remote revision is accepted', async () => {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  const local = new LocalBuildRepository(storage);
  const current = createDraft({ ...apiChat(), revision: 4 });
  const next = createDraft({ ...current.build, revision: 5, name: 'Remote update' });
  await local.save(current, null);
  const fetch = vi.fn(async () => new Response(JSON.stringify(next.build), { status: 200 }));
  const remote = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    local,
  );

  await expect(remote.save(next, 4)).resolves.toEqual(next);
  await expect(local.get(next.build.id)).resolves.toEqual(next);
  expect((await local.list()).map((item) => item.id)).toEqual([next.build.id]);
});
