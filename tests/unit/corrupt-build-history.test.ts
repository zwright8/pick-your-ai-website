// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

function storageFixture(): KeyValueStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

describe('saved-build history validation', () => {
  it.each([
    ['null revision', (record: Record<string, unknown>) => (record.revisions = [null])],
    ['missing head revision', (record: Record<string, unknown>) => (record.revisions = [])],
    [
      'duplicate revision',
      (record: Record<string, unknown>) => {
        const build = record.build as ReturnType<typeof apiChat>;
        record.revisions = [build, { ...build, name: 'Different content' }];
      },
    ],
    [
      'head content mismatch',
      (record: Record<string, unknown>) => {
        const build = record.build as ReturnType<typeof apiChat>;
        record.revisions = [{ ...build, name: 'Different content' }];
      },
    ],
    [
      'out-of-order revisions',
      (record: Record<string, unknown>) => {
        const build = record.build as ReturnType<typeof apiChat>;
        const head = { ...build, revision: 3 };
        record.build = head;
        record.revisions = [{ ...build, revision: 2 }, build, head];
      },
    ],
    [
      'foreign revision',
      (record: Record<string, unknown>) => {
        const build = record.build as ReturnType<typeof apiChat>;
        record.revisions = [{ ...build, id: 'build.foreign' }];
      },
    ],
    ['null change', (record: Record<string, unknown>) => (record.changes = [null])],
    [
      'future change',
      (record: Record<string, unknown>) => {
        const build = record.build as ReturnType<typeof apiChat>;
        record.changes = [
          {
            revision: build.revision + 1,
            at: build.updated_at,
            summary: 'Future',
            changedKinds: [],
          },
        ];
      },
    ],
    [
      'invalid change',
      (record: Record<string, unknown>) => {
        record.changes = [
          { revision: 1, at: '2026-01-01T00:00:00Z', summary: 'x', changedKinds: [9] },
        ];
      },
    ],
  ])('rejects %s without changing the stored data', async (_name, corrupt) => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const key = `pyai.build.${draft.build.id}`;
    const record = JSON.parse(storage.getItem(key) ?? '{}') as Record<string, unknown>;
    corrupt(record);
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);

    await expect(repo.get(draft.build.id)).rejects.toMatchObject({ kind: 'malformed' });
    expect((await repo.list())[0]?.name).toBe('(unreadable saved build)');
    expect(storage.getItem(key)).toBe(raw);
  });

  it('refuses to overwrite a valid record with malformed history', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const key = `pyai.build.${draft.build.id}`;
    const previous = storage.getItem(key);
    const broken = { ...draft, changes: [{ ...draft.changes[0]!, summary: null }] };

    await expect(
      repo.save(JSON.parse(JSON.stringify(broken)), draft.build.revision),
    ).rejects.toMatchObject({
      kind: 'malformed',
    });
    expect(storage.getItem(key)).toBe(previous);
  });

  it('recovers a valid current build without modifying damaged history', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const key = `pyai.build.${draft.build.id}`;
    const record = JSON.parse(storage.getItem(key) ?? '{}');
    record.changes = [null];
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);

    await expect(repo.recoverHead(draft.build.id)).resolves.toEqual(draft.build);
    expect(storage.getItem(key)).toBe(raw);
  });

  it('recovers the valid head when its retained copy disagrees', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    await repo.save(draft, null);
    const key = `pyai.build.${draft.build.id}`;
    const record = JSON.parse(storage.getItem(key) ?? '{}');
    record.revisions[0].name = 'Wrong historical content';
    const raw = JSON.stringify(record);
    storage.setItem(key, raw);
    await expect(repo.get(draft.build.id)).rejects.toMatchObject({ kind: 'malformed' });
    await expect(repo.recoverHead(draft.build.id)).resolves.toEqual(draft.build);
    expect(storage.getItem(key)).toBe(raw);
  });

  it('accepts sparse, ordered history and an empty change log', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const first = apiChat();
    const head = { ...first, revision: first.revision + 3 };
    const record = { build: head, revisions: [first, head], changes: [] };
    await expect(repo.save(record, null)).resolves.toEqual(record);
    await expect(repo.get(head.id)).resolves.toEqual(record);
  });

  it('accepts a matching history head with different object-key order', async () => {
    const repo = new LocalBuildRepository(storageFixture());
    const build = apiChat();
    const { name, ...rest } = build;
    const record = { build, revisions: [{ name, ...rest }], changes: [] };
    await expect(repo.save(record, null)).resolves.toEqual(record);
    await expect(repo.get(build.id)).resolves.toEqual(record);
  });

  it('accepts a head and history that differ only by an undefined optional property', async () => {
    const repo = new LocalBuildRepository(storageFixture());
    const revision = apiChat();
    const head = {
      ...revision,
      objectives: { ...revision.objectives, monthly_budget_amount: undefined },
    };
    const record = { build: head, revisions: [revision], changes: [] };
    expect(JSON.stringify(head)).toBe(JSON.stringify(revision));
    await expect(repo.save(record, null)).resolves.toEqual(record);
    await expect(repo.get(head.id)).resolves.toMatchObject({ build: revision });
  });

  it('refuses recovery when the current build is invalid or belongs to another ID', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    const draft = createDraft(apiChat());
    const key = `pyai.build.${draft.build.id}`;
    for (const build of [null, { ...draft.build, id: 'build.foreign' }]) {
      const raw = JSON.stringify({ build, revisions: [], changes: [null] });
      storage.setItem(key, raw);
      await expect(repo.recoverHead(draft.build.id)).rejects.toMatchObject({ kind: 'malformed' });
      expect(storage.getItem(key)).toBe(raw);
    }
  });

  it('reports an empty stored record as unreadable instead of missing', async () => {
    const storage = storageFixture();
    const repo = new LocalBuildRepository(storage);
    storage.setItem('pyai.builds.index', '["build.empty"]');
    storage.setItem('pyai.build.build.empty', '');
    expect((await repo.list())[0]?.name).toBe('(unreadable saved build)');
    await expect(repo.get('build.empty')).rejects.toMatchObject({ kind: 'malformed' });
    expect(storage.getItem('pyai.build.build.empty')).toBe('');
  });
});
