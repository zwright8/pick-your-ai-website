import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SettingsForm } from '../../src/features/builder/SettingsForm';

it('retains edited settings while refreshing untouched settings from the build', () => {
  const apply = vi.fn();
  const cancel = vi.fn();
  const view = render(
    <SettingsForm
      kind="model"
      values={{ temperature: 0.5, top_p: 0.4 }}
      onApply={apply}
      onCancel={cancel}
    />,
  );
  const temperature = screen.getByRole('textbox', { name: 'Temperature' });
  const topP = screen.getByRole('textbox', { name: 'Top p' });
  fireEvent.change(temperature, { target: { value: '0.7' } });
  view.rerender(
    <SettingsForm
      kind="model"
      values={{ temperature: 0.6, top_p: 0.8 }}
      onApply={apply}
      onCancel={cancel}
    />,
  );
  expect(temperature).toHaveValue('0.7');
  expect(topP).toHaveValue('0.8');
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(apply).toHaveBeenCalledWith({ temperature: 0.7 });
  view.rerender(
    <SettingsForm
      kind="model"
      values={{ temperature: 0.9, top_p: 0.8 }}
      onApply={apply}
      onCancel={cancel}
    />,
  );
  expect(temperature).toHaveValue('0.9');
});

it.each([
  ['a comma inside a scope', ['read,write']],
  ['an empty list', []],
  ['an empty and whitespace-sensitive scope', ['', '  scoped  ']],
])('preserves %s when only another setting is edited', (_name, allowedScopes) => {
  const apply = vi.fn();
  render(
    <SettingsForm
      kind="tool"
      values={{ allowed_scopes: allowedScopes, timeout_ms: 1000 }}
      onApply={apply}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Timeout (ms)' }), {
    target: { value: '2000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(apply).toHaveBeenCalledWith({ timeout_ms: 2000 });
  expect(Object.keys(apply.mock.calls[0]?.[0] ?? {})).toEqual(['timeout_ms']);
});

it('does not trim an untouched string when a different field changes', () => {
  const apply = vi.fn();
  render(
    <SettingsForm
      kind="vector_database"
      values={{ index_dimension: 1536, similarity_metric: 'cosine', index_name: '  production  ' }}
      onApply={apply}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Index dimension/ }), {
    target: { value: '2048' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(apply).toHaveBeenCalledWith({ index_dimension: 2048 });
  expect(Object.keys(apply.mock.calls[0]?.[0] ?? {})).toEqual(['index_dimension']);
});

it('preserves whitespace deliberately entered in a valid string field', () => {
  const apply = vi.fn();
  render(
    <SettingsForm
      kind="vector_database"
      values={{ index_dimension: 1536, similarity_metric: 'cosine', index_name: 'old' }}
      onApply={apply}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Index name' }), {
    target: { value: '  revised  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(apply).toHaveBeenCalledWith({ index_name: '  revised  ' });
});

it('keeps edits when the caller declines to apply them', () => {
  const apply = vi.fn(() => false);
  render(
    <SettingsForm kind="model" values={{ temperature: 0.5 }} onApply={apply} onCancel={vi.fn()} />,
  );
  const temperature = screen.getByRole('textbox', { name: 'Temperature' });
  fireEvent.change(temperature, { target: { value: '0.7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(apply).toHaveBeenCalledWith({ temperature: 0.7 });
  expect(temperature).toHaveValue('0.7');
});
