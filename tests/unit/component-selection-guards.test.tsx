import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft, updateSettings } from '../../src/domain/build';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import ComparePage from '../../src/pages/ComparePage';
import { BY_ID, NOW, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function show(path: string, oldVersion = false) {
  const build = updateSettings(apiChat(), 'sel_model', { temperature: 0.37 });
  if (oldVersion)
    build.selections = build.selections.map((selection) =>
      selection.id === 'sel_model'
        ? { ...selection, catalog_item_version: 'older-version' }
        : selection,
    );
  const apply = vi.fn();
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply,
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Routes>
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { build, apply };
}

describe('component selection guards', () => {
  it.each([
    ['/compare?ids=demo~model~aurora-large', 'Use this part'],
    ['/catalog/model/demo~model~aurora-large', 'Add to my stack'],
  ])('allows selecting the current version of an older component on %s', async (path, name) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { build, apply } = show(path, true);
    const button = await screen.findByRole('button', { name: new RegExp(name) });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("reset this component's settings"),
    );
    expect(apply).toHaveBeenCalledOnce();
    const [change] = apply.mock.calls[0] as [(build: BuildSnapshot) => BuildSnapshot];
    expect(
      change(build).selections.find((selection) => selection.id === 'sel_model')
        ?.catalog_item_version,
    ).toBe(item('model', 'aurora-large').version);
  });

  it.each([
    ['/compare?ids=demo~model~aurora-large', 'Use this part'],
    ['/catalog/model/demo~model~aurora-large', 'Add to my stack'],
  ])('preserves the old selection when a version update is cancelled on %s', async (path, name) => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { build, apply } = show(path, true);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
    expect(apply).not.toHaveBeenCalled();
    expect(build.selections.find((selection) => selection.id === 'sel_model')?.settings).toEqual(
      expect.objectContaining({ temperature: 0.37 }),
    );
  });

  it.each([
    ['/compare?ids=demo~model~aurora-large', 'Use this part'],
    ['/catalog/model/demo~model~aurora-large', 'In your build'],
  ])('preserves selected component settings on %s', async (path, name) => {
    const { build, apply } = show(path);
    const button = await screen.findByRole('button', { name: new RegExp(name) });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'This component is already selected');
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
    expect(build.selections.find((s) => s.id === 'sel_model')?.settings).toEqual(
      expect.objectContaining({ temperature: 0.37 }),
    );
  });

  it.each([
    ['/compare?ids=demo~model~aurora-mini', 'Use this part'],
    ['/catalog/model/demo~model~aurora-mini', 'Add to my stack'],
  ])('still allows a different component on %s', async (path, name) => {
    const { apply } = show(path);
    const button = await screen.findByRole('button', { name: new RegExp(name) });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
