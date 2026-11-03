import { expect, it, vi } from 'vitest';
import { ContractHttpClient } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

function localRepository() {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  return new LocalBuildRepository(storage);
}

it('reuses the idempotency key when a create response is lost', async () => {
  const draft = createDraft({ ...apiChat(), revision: 1 });
  let acceptedKey: string | undefined;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
    if (!acceptedKey) {
      acceptedKey = key;
      throw new Error('Response lost after acceptance');
    }
    return key === acceptedKey
      ? new Response(JSON.stringify(draft.build), { status: 201 })
      : new Response('{}', { status: 409 });
  });
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    localRepository(),
  );
  await expect(repo.save(draft, null)).rejects.toMatchObject({ kind: 'network' });
  await expect(repo.save(structuredClone(draft), null)).resolves.toMatchObject({
    build: draft.build,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not reuse an idempotency key for a different submitted payload', async () => {
  const keys: string[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)['Idempotency-Key']!);
    throw new Error('Response lost');
  });
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    localRepository(),
  );
  const first = createDraft({ ...apiChat(), revision: 1, name: 'First payload' });
  const second = createDraft({ ...first.build, name: 'Different payload' });
  await expect(repo.save(first, null)).rejects.toMatchObject({ kind: 'network' });
  await expect(repo.save(second, null)).rejects.toMatchObject({ kind: 'network' });
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});

it('reuses the idempotency key and expected revision for an update retry', async () => {
  const draft = createDraft({ ...apiChat(), revision: 2 });
  const keys: string[] = [];
  const matches: string[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    keys.push(headers['Idempotency-Key']!);
    matches.push(headers['If-Match']!);
    if (keys.length === 1) throw new Error('Response lost after acceptance');
    return keys[1] === keys[0]
      ? new Response(JSON.stringify(draft.build), { status: 200 })
      : new Response('{}', { status: 409 });
  });
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    localRepository(),
  );
  await expect(repo.save(draft, 1)).rejects.toMatchObject({ kind: 'network' });
  await expect(repo.save(structuredClone(draft), 1)).resolves.toMatchObject({ build: draft.build });
  expect(keys[1]).toBe(keys[0]);
  expect(matches).toEqual(['"1"', '"1"']);
});

it('reuses the key after the server accepted a write but the local cache failed', async () => {
  const draft = createDraft({ ...apiChat(), revision: 1 });
  const entries = new Map<string, string>();
  let blocked = true;
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (blocked) throw new Error('Storage unavailable');
      entries.set(key, value);
    },
    removeItem: (key) => void entries.delete(key),
  };
  const keys: string[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)['Idempotency-Key']!);
    return new Response(JSON.stringify(draft.build), { status: 201 });
  });
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    new LocalBuildRepository(storage),
  );
  await expect(repo.save(draft, null)).rejects.toMatchObject({ kind: 'unsupported' });
  blocked = false;
  await expect(repo.save(structuredClone(draft), null)).resolves.toMatchObject({
    build: draft.build,
  });
  expect(keys[1]).toBe(keys[0]);
});

it('accepts concurrent identical responses without overwriting a changed cache', async () => {
  const draft = createDraft({ ...apiChat(), revision: 1 });
  const pending: ((response: Response) => void)[] = [];
  const keys: string[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)['Idempotency-Key']!);
    return new Promise<Response>((resolve) => pending.push(resolve));
  });
  const local = localRepository();
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    local,
  );
  const first = repo.save(draft, null);
  const second = repo.save(structuredClone(draft), null);
  expect(keys[1]).toBe(keys[0]);
  pending[0]!(new Response(JSON.stringify(draft.build), { status: 201 }));
  await expect(first).resolves.toMatchObject({ build: draft.build });
  const third = repo.save(structuredClone(draft), null);
  expect(keys[2]).toBe(keys[0]);
  pending[1]!(new Response(JSON.stringify(draft.build), { status: 201 }));
  await expect(second).resolves.toMatchObject({ build: draft.build });
  pending[2]!(new Response(JSON.stringify(draft.build), { status: 201 }));
  await expect(third).resolves.toMatchObject({ build: draft.build });
  await expect(local.get(draft.build.id)).resolves.toMatchObject({ build: draft.build });
});

it('retains the key when one concurrent caller loses its response after another succeeds', async () => {
  const draft = createDraft({ ...apiChat(), revision: 1 });
  const pending: { resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const keys: string[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)['Idempotency-Key']!);
    return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
  });
  const repo = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    localRepository(),
  );
  const first = repo.save(draft, null);
  const second = repo.save(structuredClone(draft), null);
  pending[0]!.resolve(new Response(JSON.stringify(draft.build), { status: 201 }));
  await expect(first).resolves.toMatchObject({ build: draft.build });
  const failed = expect(second).rejects.toMatchObject({ kind: 'network' });
  pending[1]!.reject(new Error('Response lost'));
  await failed;
  const retry = repo.save(structuredClone(draft), null);
  expect(keys[2]).toBe(keys[0]);
  pending[2]!.resolve(new Response(JSON.stringify(draft.build), { status: 201 }));
  await expect(retry).resolves.toMatchObject({ build: draft.build });
});
