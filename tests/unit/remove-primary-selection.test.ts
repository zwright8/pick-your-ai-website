import { expect, it } from 'vitest';
import { primarySelection } from '../../src/domain/activation';
import { removeSelection } from '../../src/domain/build';
import { apiChat } from './scenarios';

it('promotes an enabled selection before a disabled one when removing a primary', () => {
  const build = apiChat();
  const primary = build.selections.find((selection) => selection.kind === 'model')!;
  const disabled = { ...primary, id: 'sel_model_secondary', role: 'secondary', enabled: false };
  const enabled = { ...primary, id: 'sel_model_tertiary', role: 'tertiary', enabled: true };
  const next = removeSelection(
    { ...build, selections: [...build.selections, disabled, enabled] },
    primary.id,
  );
  expect(primarySelection(next, 'model')?.id).toBe(enabled.id);
  expect(next.selections.find((selection) => selection.id === disabled.id)).toMatchObject({
    role: 'secondary',
    enabled: false,
  });
});

it('keeps a primary role for a disabled selection if none are enabled', () => {
  const build = apiChat();
  const primary = build.selections.find((selection) => selection.kind === 'model')!;
  const disabled = { ...primary, id: 'sel_model_secondary', role: 'secondary', enabled: false };
  const next = removeSelection(
    { ...build, selections: [...build.selections, disabled] },
    primary.id,
  );
  expect(next.selections.find((selection) => selection.id === disabled.id)).toMatchObject({
    role: 'primary',
    enabled: false,
  });
});
