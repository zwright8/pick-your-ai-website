import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ErrorState } from '../../src/components/feedback';
import { DataError } from '../../src/data/errors';

it('keeps the ordinary retry action for an unrelated data error', () => {
  const retry = vi.fn();
  render(
    <ErrorState error={new DataError('network', 'The data service is offline.')} onRetry={retry} />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('The data service is offline.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Reload page' })).not.toBeInTheDocument();
});
