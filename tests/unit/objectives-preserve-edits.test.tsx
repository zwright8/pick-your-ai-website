import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ObjectivesForm } from '../../src/features/builder/ObjectivesForm';
import { apiChat } from './scenarios';

it('keeps edited values while refreshing untouched fields from a changed build', () => {
  const initial = apiChat();
  const apply = vi.fn();
  const view = render(<ObjectivesForm build={initial} onApply={apply} />);
  const requests = screen.getByRole('textbox', { name: 'Requests per day' });
  fireEvent.change(requests, { target: { value: '123' } });
  const changed = {
    ...initial,
    objectives: { ...initial.objectives, requests_per_day: 55, max_concurrency: 10 },
  };
  view.rerender(<ObjectivesForm build={changed} onApply={apply} />);
  expect(requests).toHaveValue('123');
  expect(screen.getByRole('textbox', { name: 'Max concurrency' })).toHaveValue('10');
  fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
  expect(apply).toHaveBeenCalledWith({ requests_per_day: 123 }, {});
  view.rerender(
    <ObjectivesForm
      build={{ ...changed, objectives: { ...changed.objectives, requests_per_day: 200 } }}
      onApply={apply}
    />,
  );
  expect(requests).toHaveValue('200');
});

it('does not rewrite an untouched region or fill absent policy defaults', () => {
  const build = apiChat();
  build.objectives.region = '  region with spaces  ';
  delete build.policy;
  const apply = vi.fn();
  render(<ObjectivesForm build={build} onApply={apply} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Requests per day' }), {
    target: { value: '123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
  expect(apply).toHaveBeenCalledWith({ requests_per_day: 123 }, {});
  expect(Object.keys(apply.mock.calls[0]?.[0] ?? {})).toEqual(['requests_per_day']);
  expect(Object.keys(apply.mock.calls[0]?.[1] ?? {})).toEqual([]);
});

it('preserves whitespace deliberately entered in a valid region', () => {
  const apply = vi.fn();
  render(<ObjectivesForm build={apiChat()} onApply={apply} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Region / residency' }), {
    target: { value: '  new region  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
  expect(apply).toHaveBeenCalledWith({ region: '  new region  ' }, {});
});

it('submits only explicitly changed policy fields', () => {
  const apply = vi.fn();
  const build = apiChat();
  render(<ObjectivesForm build={build} onApply={apply} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Treat any unknown as blocking' }), {
    target: { value: 'true' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply objectives' }));
  expect(apply).toHaveBeenCalledWith({}, { fail_on_unknown: true });
});
