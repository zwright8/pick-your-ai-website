import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../src/components/feedback';

function Actions() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast('Cannot copy link.')}>
        Same notice
      </button>
      <button type="button" onClick={() => toast('Saved successfully.')}>
        Other notice
      </button>
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('toast live announcements', () => {
  it('clears the status after the visible notice expires', () => {
    render(
      <ToastProvider>
        <Actions />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Same notice' }));
    expect(screen.getByRole('status')).toHaveTextContent('Cannot copy link.');
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('re-announces an identical notice while the first is still visible', () => {
    render(
      <ToastProvider>
        <Actions />
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Same notice' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.querySelector('.toast.visible')).toHaveTextContent('Cannot copy link.');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status')).toHaveTextContent('Cannot copy link.');
  });

  it('does not restore an older repeated notice after a newer one', () => {
    render(
      <ToastProvider>
        <Actions />
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Same notice' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Other notice' }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully.');
  });

  it('keeps a newer notice visible until its own deadline', () => {
    render(
      <ToastProvider>
        <Actions />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Same notice' }));
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('button', { name: 'Other notice' }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully.');
    expect(document.querySelector('.toast.visible')).toHaveTextContent('Saved successfully.');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('clears pending timers on unmount', () => {
    const view = render(
      <ToastProvider>
        <Actions />
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Same notice' });
    fireEvent.click(button);
    fireEvent.click(button);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
