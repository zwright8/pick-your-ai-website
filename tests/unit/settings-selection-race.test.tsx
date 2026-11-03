import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import {
  createDraft,
  removeSelection,
  replaceSelection,
  updateObjectives,
} from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { apiChat, BY_ID, item, NOW } from './scenarios';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  localStorage.clear();
  const providers = createFixtureProviders({ now: () => NOW });
  const original = createDraft(apiChat());
  await providers.builds.save(original, null);
  localStorage.setItem('pyai.currentBuildId', original.build.id);
  let builder: ReturnType<typeof useBuilder>;
  function Probe() {
    builder = useBuilder();
    return null;
  }
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <ToastProvider>
          <Probe />
          <BuilderPage />
        </ToastProvider>
      ),
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <DataContext.Provider value={providers}>
      <QueryClientProvider client={client}>
        <BuilderProvider>
          <RouterProvider router={router} />
        </BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Configure Demo Aurora Large' }));
  const input = screen.getByRole('textbox', { name: 'Temperature' });
  await userEvent.clear(input);
  await userEvent.type(input, '0.77');
  return { getBuilder: () => builder, input, client, view };
}

it('keeps edits and blocks applying them when the selected component changes before render', async () => {
  const h = await setup();
  act(() => {
    h.getBuilder().apply(
      (build) => replaceSelection(build, 'sel_model', item('model', 'aurora-mini'), BY_ID),
      'Replace model',
      ['model'],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  });
  await waitFor(() =>
    expect(screen.getByText(/selection changed while settings were open/i)).toBeVisible(),
  );
  expect(h.input).toHaveValue('0.77');
  expect(screen.getByRole('button', { name: 'Apply settings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Apply settings' })).toHaveAccessibleDescription(
    /selection changed/i,
  );
  const current = h.getBuilder().draft?.build;
  expect(current?.revision).toBe(2);
  expect(
    current?.selections.find((selection) => selection.id === 'sel_model')?.catalog_item_id,
  ).toBe('demo.model.aurora-mini');
  expect(
    current?.selections.find((selection) => selection.id === 'sel_model')?.settings,
  ).not.toMatchObject({ temperature: 0.77 });
  h.view.unmount();
  h.client.clear();
});

it.each(['removed', 'version changed', 'different build', 'ambiguous'] as const)(
  'keeps edits visible and blocks applying them after the target is %s',
  async (change) => {
    const h = await setup();
    act(() => {
      if (change === 'different build') {
        h.getBuilder().startNew(undefined, 'Other build', true);
      } else if (change === 'removed') {
        h.getBuilder().apply((build) => removeSelection(build, 'sel_model'), 'Remove model', [
          'model',
        ]);
      } else if (change === 'version changed') {
        h.getBuilder().apply(
          (build) => ({
            ...build,
            selections: build.selections.map((selection) =>
              selection.id === 'sel_model'
                ? { ...selection, catalog_item_version: 'other-version' }
                : selection,
            ),
          }),
          'Change version',
          ['model'],
        );
      } else {
        h.getBuilder().apply(
          (build) => {
            const model = build.selections.find((selection) => selection.id === 'sel_model');
            return model
              ? { ...build, selections: [...build.selections, { ...model, role: 'secondary' }] }
              : build;
          },
          'Duplicate selection ID',
          ['model'],
        );
      }
    });
    await waitFor(() =>
      expect(screen.getByText(/selection changed while settings were open/i)).toBeVisible(),
    );
    expect(h.input).toHaveValue('0.77');
    expect(screen.getByRole('button', { name: 'Apply settings' })).toBeDisabled();
    h.view.unmount();
    h.client.clear();
  },
);

it('applies edits to the same selection after an unrelated draft change', async () => {
  const h = await setup();
  act(() =>
    h
      .getBuilder()
      .apply((build) => updateObjectives(build, { requests_per_day: 4321 }), 'Change objective', [
        'workload',
      ]),
  );
  await waitFor(() => expect(h.getBuilder().draft?.build.objectives.requests_per_day).toBe(4321));
  expect(h.input).toHaveValue('0.77');
  await userEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  await waitFor(() => expect(h.getBuilder().draft?.build.revision).toBe(3));
  expect(h.getBuilder().draft?.build.objectives.requests_per_day).toBe(4321);
  expect(
    h.getBuilder().draft?.build.selections.find((selection) => selection.id === 'sel_model')
      ?.settings,
  ).toMatchObject({ temperature: 0.77 });
  h.view.unmount();
  h.client.clear();
});

it('discards the old edit only after confirmation and opens the new selection cleanly', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  const h = await setup();
  act(() =>
    h
      .getBuilder()
      .apply(
        (build) => replaceSelection(build, 'sel_model', item('model', 'aurora-mini'), BY_ID),
        'Replace model',
        ['model'],
      ),
  );
  await screen.findByText(/selection changed while settings were open/i);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).toHaveBeenCalledWith('Discard unapplied component settings?');
  expect(h.input).toHaveValue('0.77');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Configure Demo Aurora Mini' }));
  expect(screen.getByRole('textbox', { name: 'Temperature' })).not.toHaveValue('0.77');
  h.view.unmount();
  h.client.clear();
});
