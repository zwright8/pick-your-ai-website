import { expect, it, vi } from 'vitest';
import { ContractHttpClient } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
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
  const local = new LocalBuildRepository(storage);
  const replies: ((response: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => replies.push(resolve)));
  const remote = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    local,
  );
  return { entries, local, remote, replies };
}

const build = (revision: number) => ({ ...apiChat(), revision, name: `Revision ${revision}` });
const response = (value: ReturnType<typeof build>) =>
  new Response(JSON.stringify(value), { status: 200 });

it('does not replace a newer cached revision when an older accepted response arrives late', async () => {
  const { local, remote, replies } = fixture();
  await local.save(createDraft(build(1)), null);
  const older = remote.save(createDraft(build(2)), 1);
  const newer = remote.save(createDraft(build(3)), 2);
  expect(replies).toHaveLength(2);
  replies[1]?.(response(build(3)));
  await expect(newer).resolves.toMatchObject({ build: { revision: 3 } });
  replies[0]?.(response(build(2)));
  await expect(older).rejects.toMatchObject({
    kind: 'conflict',
    message: expect.stringContaining('accepted'),
  });
  expect((await local.get(build(3).id)).build.revision).toBe(3);
});

it('preserves the submitted history when the caller mutates its draft during the request', async () => {
  const { local, remote, replies } = fixture();
  const candidate = createDraft(build(2));
  const original = structuredClone(candidate);
  const pending = remote.save(candidate, 1);
  expect(replies).toHaveLength(1);
  candidate.revisions[0]!.name = 'Mutated after dispatch';
  candidate.changes[0]!.summary = 'Mutated after dispatch';
  replies[0]?.(response(original.build));
  await expect(pending).resolves.toEqual(original);
  expect(await local.get(original.build.id)).toEqual(original);
});

it('preserves a cached build deleted while the remote save is in flight', async () => {
  const { local, remote, replies } = fixture();
  await local.save(createDraft(build(1)), null);
  const pending = remote.save(createDraft(build(2)), 1);
  await local.remove(build(1).id);
  replies[0]?.(response(build(2)));
  await expect(pending).rejects.toMatchObject({
    kind: 'conflict',
    message: expect.stringContaining('remote save was accepted'),
  });
  await expect(local.get(build(1).id)).rejects.toMatchObject({ kind: 'not_found' });
});

it('does not replace a newer cache that already existed when the remote request began', async () => {
  const { local, remote, replies } = fixture();
  await local.save(createDraft(build(3)), null);
  const pending = remote.save(createDraft(build(2)), 1);
  replies[0]?.(response(build(2)));
  await expect(pending).rejects.toMatchObject({
    kind: 'conflict',
    message: expect.stringContaining('remote save was accepted'),
  });
  expect((await local.get(build(3).id)).build.revision).toBe(3);
});

it('reports remote success when browser storage is unavailable', async () => {
  const storage: KeyValueStorage = {
    getItem: () => {
      throw new Error('storage unavailable');
    },
    setItem: () => {
      throw new Error('storage unavailable');
    },
    removeItem: () => {
      throw new Error('storage unavailable');
    },
  };
  const local = new LocalBuildRepository(storage);
  const fetch = vi.fn(async () => response(build(2)));
  const remote = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
    local,
  );
  await expect(remote.save(createDraft(build(2)), 1)).rejects.toMatchObject({
    kind: 'unsupported',
    message: expect.stringContaining('remote save was accepted'),
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it('accepts an identical cached revision without rewriting its record', async () => {
  const { local, remote, replies } = fixture();
  const candidate = createDraft(build(2));
  await local.save(candidate, null);
  const { name, ...remaining } = candidate.build;
  const reordered = { name, ...remaining };
  const pending = remote.save(candidate, 1);
  replies[0]?.(response(reordered));
  await expect(pending).resolves.toEqual(candidate);
  expect(await local.get(candidate.build.id)).toEqual(candidate);
});

it('accepts a cached history that differs only by an omitted undefined property', async () => {
  const { local, remote, replies } = fixture();
  const candidate = createDraft(build(2));
  const previous = build(1);
  candidate.revisions.unshift({
    ...previous,
    objectives: { ...previous.objectives, monthly_budget_amount: undefined },
  });
  await local.save(candidate, null);
  const pending = remote.save(candidate, 1);
  replies[0]?.(response(build(2)));
  await expect(pending).resolves.toMatchObject({ build: candidate.build });
});

it('does not replace a different cached record at the same revision', async () => {
  const { local, remote, replies } = fixture();
  const current = createDraft({ ...build(2), name: 'Existing local record' });
  await local.save(current, null);
  const pending = remote.save(createDraft(build(2)), 1);
  replies[0]?.(response(build(2)));
  await expect(pending).rejects.toMatchObject({
    kind: 'conflict',
    message: expect.stringContaining('remote save was accepted'),
  });
  expect(await local.get(current.build.id)).toEqual(current);
});

it('preserves an unreadable local record after the remote save is accepted', async () => {
  const { entries, local, remote, replies } = fixture();
  const key = `pyai.build.${build(2).id}`;
  entries.set(key, '{broken');
  const pending = remote.save(createDraft(build(2)), 1);
  replies[0]?.(response(build(2)));
  await expect(pending).rejects.toMatchObject({
    kind: 'unsupported',
    message: expect.stringContaining('remote save was accepted'),
  });
  expect(entries.get(key)).toBe('{broken');
  await expect(local.get(build(2).id)).rejects.toMatchObject({ kind: 'malformed' });
});

it('keeps the accepted server head consistent with the retained revision', async () => {
  const { local, remote, replies } = fixture();
  const candidate = createDraft(build(2));
  candidate.revisions.unshift(build(1));
  const before = structuredClone(candidate);
  const accepted = { ...build(2), name: 'Server-normalized name' };
  const pending = remote.save(candidate, 1);
  replies[0]?.(response(accepted));
  const saved = await pending;

  expect(saved.build).toEqual(accepted);
  expect(saved.revisions).toEqual([build(1), accepted]);
  expect(await local.get(accepted.id)).toEqual(saved);
  expect(candidate).toEqual(before);
});

it('adds the accepted head when the submitted retained history does not contain it', async () => {
  const { local, remote, replies } = fixture();
  const candidate = createDraft(build(2));
  candidate.revisions = [build(1)];
  const accepted = { ...build(2), name: 'Server-normalized name' };
  const pending = remote.save(candidate, 1);
  replies[0]?.(response(accepted));
  const saved = await pending;

  expect(saved.revisions).toEqual([build(1), accepted]);
  expect(await local.get(accepted.id)).toEqual(saved);
});
