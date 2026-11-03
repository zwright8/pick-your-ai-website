import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '../../src/features/builder/SettingsForm';

describe('numeric component settings', () => {
  it.each(['1.5', '12abc', '1e999', '0x10', '9007199254740993'])(
    'does not silently change invalid integer input %s',
    (input) => {
      const onApply = vi.fn();
      render(<SettingsForm kind="workload" values={{}} onApply={onApply} onCancel={vi.fn()} />);
      const field = screen.getByRole('textbox', { name: 'Concurrency' });
      fireEvent.change(field, { target: { value: input } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
      expect(onApply).not.toHaveBeenCalled();
      expect(field).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('rejects zero for a strictly positive contract field', () => {
    const onApply = vi.fn();
    render(<SettingsForm kind="model" values={{}} onApply={onApply} onCancel={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Top p' });
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it.each(['Infinity', '1e999', '0x10', '1.2abc'])(
    'rejects malformed or non-finite decimal input %s',
    (input) => {
      const onApply = vi.fn();
      render(<SettingsForm kind="model" values={{}} onApply={onApply} onCancel={vi.fn()} />);
      const field = screen.getByRole('textbox', { name: 'Temperature' });
      fireEvent.change(field, { target: { value: input } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
      expect(onApply).not.toHaveBeenCalled();
      expect(field).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('accepts a valid integer and fractional number unchanged', () => {
    const onApply = vi.fn();
    render(<SettingsForm kind="model" values={{}} onApply={onApply} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Max output (tokens)' }), {
      target: { value: '123' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Top p' }), { target: { value: '.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ max_output_tokens: 123, top_p: 0.5 }),
    );
  });
});
