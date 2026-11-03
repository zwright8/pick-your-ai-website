import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { validateContract, validatorsReady } from '../../src/contracts';
import { SettingsForm } from '../../src/features/builder/SettingsForm';
import { apiChat } from './scenarios';

describe('URI settings', () => {
  it.each(['not a uri', '/relative/path', 'https://bad host/path', ' https://example.test '])(
    'rejects malformed URI %s before applying settings',
    (value) => {
      const apply = vi.fn();
      render(<SettingsForm kind="mcp_server" values={{}} onApply={apply} onCancel={vi.fn()} />);
      const endpoint = screen.getByRole('textbox', { name: 'Endpoint' });
      fireEvent.change(endpoint, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
      expect(apply).not.toHaveBeenCalled();
      expect(endpoint).toHaveAttribute('aria-invalid', 'true');
      expect(endpoint).toHaveAccessibleDescription(/URI/i);
    },
  );

  it.each(['https://example.test/service', 'urn:example:service'])(
    'accepts contract-valid URI %s',
    (value) => {
      const apply = vi.fn();
      render(<SettingsForm kind="mcp_server" values={{}} onApply={apply} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Endpoint' }), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ endpoint: value }));
    },
  );

  it.each([
    ['not a uri', false],
    ['/relative/path', false],
    ['https://bad host/path', false],
    ['https://example.test/service', true],
    ['urn:example:service', true],
  ])('uses the same URI rules as the contract for %s', async (endpoint, valid) => {
    await validatorsReady;
    const selection = { ...apiChat().selections[0]!, kind: 'mcp_server', settings: { endpoint } };
    expect(validateContract('Selection', selection).ok).toBe(valid);
  });
});
