import { beforeEach, expect, it, vi } from 'vitest';
import { ContractHttpClient } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { createBuild, createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

beforeEach(() => localStorage.clear());

it('rejects an incomplete remote draft locally without sending an invalid snapshot', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 422 }));
  const repository = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
  );
  const draft = createDraft(createBuild({ catalogSnapshotId: 'catalog.demo.1' }));
  await expect(repository.save(draft, null)).rejects.toMatchObject({
    kind: 'malformed',
    message: expect.stringContaining('Remote storage cannot save incomplete drafts'),
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('still creates a contract-valid remote build at revision one', async () => {
  const build = { ...apiChat(), revision: 1 };
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(build), { status: 201 }),
  );
  const repository = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: 'https://api.test', fetch }),
  );
  await expect(repository.save(createDraft(build), null)).resolves.toMatchObject({ build });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
});
