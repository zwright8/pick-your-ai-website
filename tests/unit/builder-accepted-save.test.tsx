import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { StoredBuild } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import { NOW, apiChat } from './scenarios';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

function unloadAllowed() {
  return window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
}

function harness(
  save: (draft: StoredBuild, expected: number | null) => Promise<StoredBuild>,
  get?: (id: string) => Promise<StoredBuild>,
  strict = false,
) {
  const providers = createFixtureProviders({ now: () => NOW });
  vi.spyOn(providers.builds, 'save').mockImplementation(save);
  if (get) vi.spyOn(providers.builds, 'get').mockImplementation(get);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        {strict ? (
          <StrictMode>
            <BuilderProvider>{children}</BuilderProvider>
          </StrictMode>
        ) : (
          <BuilderProvider>{children}</BuilderProvider>
        )}
      </QueryClientProvider>
    </DataContext.Provider>
  );
  return renderHook(() => useBuilder(), { wrapper });
}

it('persists one revision for one edit under Strict Mode', async () => {
  const save = vi.fn(async (draft: StoredBuild) => draft);
  const hook = harness(save, undefined, true);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'One edit' }), 'Edit', []));
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  expect(save).toHaveBeenCalledTimes(1);
});

it('saves a Strict Mode edit through the real local repository without a conflict', async () => {
  const repository = createFixtureProviders({ now: () => NOW }).builds;
  const hook = harness((draft, expected) => repository.save(draft, expected), undefined, true);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'One edit' }), 'Edit', []));
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  const id = hook.result.current.draft?.build.id;
  if (!id) throw new Error('Missing build ID');
  const saved = await repository.get(id);
  expect(saved.build.name).toBe('One edit');
  expect(saved.changes.filter((change) => change.summary === 'Edit')).toHaveLength(1);
});

it('keeps consecutive edits made in one batch in order under Strict Mode', async () => {
  const requests: { draft: StoredBuild; expected: number | null }[] = [];
  const hook = harness(
    async (draft, expected) => {
      requests.push({ draft, expected });
      return draft;
    },
    undefined,
    true,
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => {
    hook.result.current.apply((build) => ({ ...build, name: 'First' }), 'First', []);
    hook.result.current.apply(
      (build) => ({ ...build, name: `${build.name} second` }),
      'Second',
      [],
    );
  });
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  expect(requests.map((request) => request.draft.build.name)).toEqual(['First', 'First second']);
  expect(requests.map((request) => request.expected)).toEqual([null, 2]);
  expect(hook.result.current.draft?.build.name).toBe('First second');
});

it('preserves newer edits to a build deleted while its save is in flight', async () => {
  const requests: { draft: StoredBuild; resolve: (value: StoredBuild) => void }[] = [];
  const hook = harness((draft) => new Promise((resolve) => requests.push({ draft, resolve })));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0]!.resolve(requests[0]!.draft));
  const original = hook.result.current.draft!.build;
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'New edit' }), 'Edit', []));
  await waitFor(() => expect(requests).toHaveLength(2));
  act(() => {
    expect(
      hook.result.current.startNew(undefined, undefined, true, {
        id: original.id,
        revision: original.revision,
      }),
    ).toBe(false);
  });
  expect(hook.result.current.draft?.build.name).toBe('New edit');
  expect(hook.result.current.saveState).toMatchObject({ status: 'error', unsaved: true });
  expect(unloadAllowed()).toBe(false);
  await act(async () => requests[1]!.resolve(requests[1]!.draft));
  expect(hook.result.current.saveState).toMatchObject({ status: 'error', unsaved: true });
  expect(hook.result.current.draft?.build.name).toBe('New edit');
});

it('ignores an older open request after a newer build has opened', async () => {
  const pending: Record<string, (value: StoredBuild) => void> = {};
  const hook = harness(
    async (draft) => draft,
    (id) => new Promise((resolve) => (pending[id] = resolve)),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const first = createDraft({ ...apiChat(), id: 'build.local.first', name: 'First' });
  const second = createDraft({ ...apiChat(), id: 'build.local.second', name: 'Second' });
  let firstResult: Promise<boolean>;
  let secondResult: Promise<boolean>;
  act(() => {
    firstResult = hook.result.current.open(first.build.id);
    secondResult = hook.result.current.open(second.build.id);
  });
  await act(async () => pending[second.build.id]!(second));
  expect(await secondResult!).toBe(true);
  await act(async () => pending[first.build.id]!(first));
  expect(await firstResult!).toBe(false);
  expect(hook.result.current.draft?.build.id).toBe(second.build.id);
  expect(localStorage.getItem('pyai.currentBuildId')).toBe(second.build.id);
});

it('does not open a build when its request is cancelled before the response', async () => {
  let resolveOpen: ((value: StoredBuild) => void) | undefined;
  const hook = harness(
    async (draft) => draft,
    () => new Promise((resolve) => (resolveOpen = resolve)),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const original = hook.result.current.draft?.build.id;
  const stored = createDraft({ ...apiChat(), id: 'build.local.cancelled', name: 'Cancelled' });
  const controller = new AbortController();
  let result: Promise<boolean>;
  act(() => {
    result = hook.result.current.open(stored.build.id, controller.signal);
    controller.abort();
  });
  await act(async () => resolveOpen!(stored));
  expect(await result!).toBe(false);
  expect(hook.result.current.draft?.build.id).toBe(original);
  expect(localStorage.getItem('pyai.currentBuildId')).toBeNull();
});

it('ignores an open failure after its request is cancelled', async () => {
  let rejectOpen: ((reason: Error) => void) | undefined;
  const hook = harness(
    async (draft) => draft,
    () => new Promise((_resolve, reject) => (rejectOpen = reject)),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const controller = new AbortController();
  let result: Promise<boolean>;
  act(() => {
    result = hook.result.current.open('build.local.cancelled', controller.signal);
    controller.abort();
  });
  await act(async () => rejectOpen!(new Error('Network failed')));
  expect(await result!).toBe(false);
});

it('does not replace a new draft with an earlier open response', async () => {
  let resolveOpen: ((value: StoredBuild) => void) | undefined;
  const hook = harness(
    async (draft) => draft,
    () => new Promise((resolve) => (resolveOpen = resolve)),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const old = createDraft({ ...apiChat(), id: 'build.local.old', name: 'Old' });
  let result: Promise<boolean>;
  act(() => {
    result = hook.result.current.open(old.build.id);
    hook.result.current.startNew();
  });
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  const newId = hook.result.current.draft?.build.id;
  await act(async () => resolveOpen!(old));
  expect(await result!).toBe(false);
  expect(hook.result.current.draft?.build.id).toBe(newId);
  expect(localStorage.getItem('pyai.currentBuildId')).toBe(newId);
});

it('ignores a stale open failure after a later edit', async () => {
  let rejectOpen: ((reason: Error) => void) | undefined;
  const hook = harness(
    async (draft) => draft,
    () => new Promise((_resolve, reject) => (rejectOpen = reject)),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let result: Promise<boolean>;
  act(() => {
    result = hook.result.current.open('build.local.old');
    hook.result.current.apply((build) => ({ ...build, name: 'New edit' }), 'Edit', []);
  });
  await act(async () => rejectOpen!(new Error('Old request failed')));
  expect(await result!).toBe(false);
  expect(hook.result.current.draft?.build.name).toBe('New edit');
});

it('saves rapid edits in revision order using the preceding accepted revision', async () => {
  const requests: {
    draft: StoredBuild;
    expected: number | null;
    resolve: (value: StoredBuild) => void;
  }[] = [];
  const hook = harness(
    (draft, expected) => new Promise((resolve) => requests.push({ draft, expected, resolve })),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Edited' }), 'Edit', []));
  expect(requests).toHaveLength(1);
  expect(hook.result.current.saveState.status).toBe('saving');
  await act(async () => requests[0]!.resolve(requests[0]!.draft));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.expected).toBe(requests[0]!.draft.build.revision);
  expect(requests[1]!.draft.build.name).toBe('Edited');
  await act(async () => requests[1]!.resolve(requests[1]!.draft));
  expect(hook.result.current.saveState.status).toBe('saved');
});

function normalized(draft: StoredBuild, name: string): StoredBuild {
  const build = { ...draft.build, name };
  return {
    ...draft,
    build,
    revisions: draft.revisions.map((revision) =>
      revision.revision === build.revision ? build : revision,
    ),
  };
}

it('warns while a save is pending and stops warning after it succeeds', async () => {
  let complete: (() => void) | undefined;
  const hook = harness((draft) => new Promise((resolve) => (complete = () => resolve(draft))));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(unloadAllowed()).toBe(true);
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(complete).toBeDefined());
  expect(unloadAllowed()).toBe(false);
  await act(async () => complete?.());
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  expect(unloadAllowed()).toBe(true);
});

it('registers the unload warning synchronously when an edit is queued', async () => {
  const hook = harness(() => new Promise(() => {}));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => {
    hook.result.current.apply((build) => ({ ...build, name: 'Pending' }), 'Edit', []);
    expect(unloadAllowed()).toBe(false);
  });
});

it('shows the server-accepted head and history after saving', async () => {
  const hook = harness(async (draft) => normalized(draft, 'Server-normalized'));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Submitted' }), 'Rename', []));
  await waitFor(() => expect(hook.result.current.saveState.status).toBe('saved'));
  expect(hook.result.current.draft?.build.name).toBe('Server-normalized');
  expect(hook.result.current.draft?.revisions.at(-1)?.name).toBe('Server-normalized');
});

it('does not replace a newer edit when an older save finishes', async () => {
  const requests: { draft: StoredBuild; resolve: (value: StoredBuild) => void }[] = [];
  const hook = harness((draft) => new Promise((resolve) => requests.push({ draft, resolve })));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'First' }), 'First', []));
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Second' }), 'Second', []));
  await act(async () => requests[0]?.resolve(normalized(requests[0].draft, 'Older accepted')));
  expect(hook.result.current.draft?.build.name).toBe('Second');
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1]?.resolve(normalized(requests[1].draft, 'Latest accepted')));
  await waitFor(() => expect(hook.result.current.draft?.build.name).toBe('Latest accepted'));
});

it('does not let an earlier build save change the current build pointer', async () => {
  const requests: { draft: StoredBuild; resolve: (value: StoredBuild) => void }[] = [];
  const hook = harness((draft) => new Promise((resolve) => requests.push({ draft, resolve })));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(2));
  const current = requests[1]!.draft;
  await act(async () => requests[1]!.resolve(current));
  await act(async () => requests[0]!.resolve(requests[0]!.draft));
  expect(hook.result.current.draft?.build.id).toBe(current.build.id);
  expect(localStorage.getItem('pyai.currentBuildId')).toBe(current.build.id);
  expect(hook.result.current.saveState.status).toBe('saved');
});

it('does not report a newer edit as saved when an older save finishes first', async () => {
  const requests: { draft: StoredBuild; resolve: (value: StoredBuild) => void }[] = [];
  const hook = harness((draft) => new Promise((resolve) => requests.push({ draft, resolve })));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'First' }), 'First', []));
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Second' }), 'Second', []));
  await act(async () => requests[0]!.resolve(requests[0]!.draft));
  expect(hook.result.current.saveState.status).toBe('saving');
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1]!.resolve(requests[1]!.draft));
  expect(hook.result.current.saveState.status).toBe('saved');
});

it('keeps later edits unsaved and does not send them after an earlier save fails', async () => {
  const requests: { draft: StoredBuild; reject: (reason: Error) => void }[] = [];
  const hook = harness(
    (draft) => new Promise((_resolve, reject) => requests.push({ draft, reject })),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Edited' }), 'Edit', []));
  await act(async () => requests[0]!.reject(new Error('Unavailable')));
  expect(hook.result.current.draft?.build.name).toBe('Edited');
  expect(hook.result.current.saveState.status).toBe('error');
  expect(requests).toHaveLength(1);
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Edited again' }), 'Edit', []));
  expect(hook.result.current.saveState.status).toBe('error');
  expect(requests).toHaveLength(1);
});

it('retries a failed save and then persists later edits in order', async () => {
  const requests: {
    draft: StoredBuild;
    expected: number | null;
    resolve: (value: StoredBuild) => void;
    reject: (reason: Error) => void;
  }[] = [];
  const hook = harness(
    (draft, expected) =>
      new Promise((resolve, reject) => requests.push({ draft, expected, resolve, reject })),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'First edit' }), 'Edit', []));
  await act(async () => requests[0]!.reject(new Error('Temporarily unavailable')));
  act(() => hook.result.current.apply((build) => ({ ...build, name: 'Second edit' }), 'Edit', []));
  const state = hook.result.current.saveState;
  expect(state.status).toBe('error');
  if (state.status !== 'error' || !state.retry) throw new Error('Expected a retry action');
  act(() => state.retry!());
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.expected).toBeNull();
  expect(requests[1]!.draft.build.revision).toBe(requests[0]!.draft.build.revision);
  await act(async () => requests[1]!.resolve(requests[1]!.draft));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]!.expected).toBe(requests[1]!.draft.build.revision);
  await act(async () => requests[2]!.resolve(requests[2]!.draft));
  await waitFor(() => expect(requests).toHaveLength(4));
  expect(requests[3]!.expected).toBe(requests[2]!.draft.build.revision);
  await act(async () => requests[3]!.resolve(requests[3]!.draft));
  expect(hook.result.current.draft?.build.name).toBe('Second edit');
  expect(hook.result.current.saveState.status).toBe('saved');
});

it('ignores an earlier build save failure after a new build is saved', async () => {
  const requests: {
    draft: StoredBuild;
    resolve: (value: StoredBuild) => void;
    reject: (reason: Error) => void;
  }[] = [];
  const hook = harness(
    (draft) => new Promise((resolve, reject) => requests.push({ draft, resolve, reject })),
  );
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => hook.result.current.startNew());
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1]!.resolve(requests[1]!.draft));
  await act(async () => requests[0]!.reject(new Error('Old save failed')));
  expect(hook.result.current.saveState.status).toBe('saved');
  expect(localStorage.getItem('pyai.currentBuildId')).toBe(requests[1]!.draft.build.id);
});
