import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { commit, createDraft } from '../../src/domain/build';
import { apiChat, NOW } from './scenarios';

for (const hadExtensions of [true, false]) {
  it(`restores historical locks and ${hadExtensions ? 'values' : 'absence'} of extensions`, async () => {
    localStorage.clear();
    const providers = createFixtureProviders({ now: () => NOW });
    const first = apiChat();
    if (hadExtensions) first.extensions = { x_note: { version: 'old' } };
    const initial = createDraft(first);
    const changed = commit(
      initial,
      (build) => ({
        ...build,
        locks: { ...build.locks, catalog_snapshot_id: 'catalog.changed' },
        extensions: { x_note: { version: 'new' } },
        lifecycle: 'validated',
      }),
      'Change snapshot',
      [],
    );
    await providers.builds.save(initial, null);
    await providers.builds.save(changed, first.revision);
    localStorage.setItem('pyai.currentBuildId', first.id);
    let builder: ReturnType<typeof useBuilder> | undefined;
    function Probe() {
      builder = useBuilder();
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <DataContext.Provider value={providers}>
        <QueryClientProvider client={client}>
          <BuilderProvider>
            <Probe />
          </BuilderProvider>
        </QueryClientProvider>
      </DataContext.Provider>,
    );
    await waitFor(() => expect(builder?.draft?.build.revision).toBe(2));
    act(() => builder?.restore(1));
    await waitFor(() => expect(builder?.saveState.status).toBe('saved'));
    const restored = await providers.builds.get(first.id);
    expect(restored.build.revision).toBe(3);
    expect(restored.build.locks).toEqual(first.locks);
    expect(restored.build.extensions).toEqual(first.extensions);
    expect('extensions' in restored.build).toBe(hadExtensions);
    expect(restored.build.lifecycle).toBe('validated');
    expect(restored.revisions[0]).toEqual(first);
    const staleRestore = builder?.restore;
    expect(staleRestore).toBeDefined();
    act(() => {
      builder?.startNew(undefined, 'A different build');
      staleRestore?.(1);
    });
    await waitFor(() => expect(builder?.draft?.build.name).toBe('A different build'));
    expect(builder?.draft?.build.revision).toBe(1);
    view.unmount();
    client.clear();
  });
}
