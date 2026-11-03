// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { validatorsReady } from '../../src/contracts';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { withBuildStorageLock } from '../../src/data/storage-lock';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

afterEach(() => vi.unstubAllGlobals());

function storageFixture() {
  const entries = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  return { entries, repo: new LocalBuildRepository(storage) };
}

it('captures the submitted draft before waiting for the lock', async () => {
  await validatorsReady;
  let release: (() => void) | undefined;
  const request = vi.fn(
    (_name: string, _options: unknown, operation: () => unknown) =>
      new Promise((resolve) => {
        release = () => resolve(operation());
      }),
  );
  vi.stubGlobal('navigator', { locks: { request } });
  const { repo } = storageFixture();
  const draft = createDraft(apiChat());
  const original = structuredClone(draft);
  const pending = repo.save(draft, null);
  await vi.waitFor(() => expect(release).toBeDefined());
  draft.build.name = 'Changed after submission';
  release!();
  await expect(pending).resolves.toEqual(original);
  expect(request).toHaveBeenCalledWith(
    'pickyour-ai.local-builds.v1',
    { mode: 'exclusive' },
    expect.any(Function),
  );
});

it('captures a remote cache update before waiting for the lock', async () => {
  await validatorsReady;
  let release: (() => void) | undefined;
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, _options: unknown, operation: () => unknown) =>
        new Promise((resolve) => {
          release = () => resolve(operation());
        }),
    },
  });
  const { repo } = storageFixture();
  const draft = createDraft(apiChat());
  const original = structuredClone(draft);
  const pending = repo.cacheRemote(draft, null);
  await vi.waitFor(() => expect(release).toBeDefined());
  draft.build.name = 'Changed after submission';
  release!();
  await expect(pending).resolves.toEqual(original);
});

it('uses the existing storage behavior when Web Locks is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  const { repo } = storageFixture();
  const draft = createDraft(apiChat());
  await expect(repo.save(draft, null)).resolves.toEqual(draft);
  await expect(repo.get(draft.build.id)).resolves.toEqual(draft);
});

it('does not write without the lock if acquiring it fails', async () => {
  vi.stubGlobal('navigator', {
    locks: { request: () => Promise.reject(new Error('Lock denied')) },
  });
  const { entries, repo } = storageFixture();
  await expect(repo.save(createDraft(apiChat()), null)).rejects.toThrow('Lock denied');
  expect([...entries]).toEqual([]);
});

it('releases the lock after a synchronous operation throws', async () => {
  let held = false;
  vi.stubGlobal('navigator', {
    locks: {
      request: (_name: string, _options: unknown, operation: () => unknown) => {
        if (held) return Promise.reject(new Error('Lock was retained'));
        held = true;
        try {
          return Promise.resolve(operation()).finally(() => {
            held = false;
          });
        } catch (error) {
          return Promise.reject(error);
        }
      },
    },
  });
  await expect(
    withBuildStorageLock(() => {
      throw new Error('Storage failed');
    }),
  ).rejects.toThrow('Storage failed');
  await expect(withBuildStorageLock(() => 'available')).resolves.toBe('available');
});
