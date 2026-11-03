import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObjectivesForm } from '../../src/features/builder/ObjectivesForm';
import { apiChat } from './scenarios';

describe('numeric objectives', () => {
  it('associates budget guidance and any validation error with the field', () => {
    const apply = vi.fn();
    render(<ObjectivesForm build={apiChat()} onApply={apply} />);
    const budget = screen.getByRole('textbox', { name: 'Monthly budget' });
    expect(budget).toHaveAccessibleDescription(/only with a cost policy/i);
    fireEvent.change(budget, { target: { value: 'not money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
    expect(budget).toHaveAccessibleDescription(/only with a cost policy.*non-negative decimal/i);
    expect(apply).not.toHaveBeenCalled();
  });

  it.each(['0x10', '0b10', '9007199254740993', '1e999', '12abc', '1.5'])(
    'rejects malformed or unsafe integer %s',
    (input) => {
      const apply = vi.fn();
      render(<ObjectivesForm build={apiChat()} onApply={apply} />);
      const field = screen.getByRole('textbox', { name: 'Requests per day' });
      fireEvent.change(field, { target: { value: input } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
      expect(apply).not.toHaveBeenCalled();
      expect(field).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('treats a whitespace-only optional field as unset', () => {
    const apply = vi.fn();
    render(<ObjectivesForm build={apiChat()} onApply={apply} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Requests per day' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ requests_per_day: undefined }),
      expect.any(Object),
    );
  });

  it('accepts a safe integer without changing its value', () => {
    const apply = vi.fn();
    render(<ObjectivesForm build={apiChat()} onApply={apply} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Requests per day' }), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ requests_per_day: 1234 }),
      expect.any(Object),
    );
  });
});
