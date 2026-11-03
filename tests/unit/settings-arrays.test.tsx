import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SettingsForm } from '../../src/features/builder/SettingsForm';

it('rejects duplicate scopes required to be unique by the contract', () => {
  const onApply = vi.fn();
  render(<SettingsForm kind="tool" values={{}} onApply={onApply} onCancel={vi.fn()} />);
  const scopes = screen.getByRole('textbox', { name: 'Allowed scopes' });
  expect(scopes).toHaveAccessibleDescription(/JSON array of strings/i);
  fireEvent.change(scopes, { target: { value: 'read, write, read' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(scopes).toHaveAttribute('aria-invalid', 'true');
  expect(scopes).toHaveAccessibleDescription(/duplicate/i);
  fireEvent.change(scopes, { target: { value: 'read, write' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({ allowed_scopes: ['read', 'write'] }),
  );
});

it('edits scopes containing commas, empty strings and whitespace with JSON array syntax', () => {
  const onApply = vi.fn();
  const original = ['read,write', '', '  scoped  '];
  render(
    <SettingsForm
      kind="tool"
      values={{ allowed_scopes: original }}
      onApply={onApply}
      onCancel={vi.fn()}
    />,
  );
  const scopes = screen.getByRole('textbox', { name: 'Allowed scopes' });
  expect(scopes).toHaveValue(JSON.stringify(original));
  fireEvent.change(scopes, { target: { value: '["read,write", "", "  revised  "]' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).toHaveBeenCalledWith({ allowed_scopes: ['read,write', '', '  revised  '] });
});

it('accepts an explicit empty list and rejects malformed JSON arrays', () => {
  const onApply = vi.fn();
  render(<SettingsForm kind="tool" values={{}} onApply={onApply} onCancel={vi.fn()} />);
  const scopes = screen.getByRole('textbox', { name: 'Allowed scopes' });
  fireEvent.change(scopes, { target: { value: '["read", 3]' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(scopes).toHaveAccessibleDescription(/JSON array of strings/i);
  fireEvent.change(scopes, { target: { value: '["read",' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).not.toHaveBeenCalled();
  expect(scopes).toHaveAccessibleDescription(/JSON array of strings/i);
  fireEvent.change(scopes, { target: { value: '[]' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
  expect(onApply).toHaveBeenCalledWith({ allowed_scopes: [] });
});

it.each(['read\nwrite', 'read\twrite', 'read\u0000write'])(
  'preserves a scope containing control characters when editing the list',
  (entry) => {
    const onApply = vi.fn();
    render(
      <SettingsForm
        kind="tool"
        values={{ allowed_scopes: [entry] }}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    const scopes = screen.getByRole('textbox', { name: 'Allowed scopes' });
    expect(scopes).toHaveValue(JSON.stringify([entry]));
    fireEvent.change(scopes, { target: { value: JSON.stringify([entry, 'other']) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    expect(onApply).toHaveBeenCalledWith({ allowed_scopes: [entry, 'other'] });
  },
);
