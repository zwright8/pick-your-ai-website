import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import MethodologyPage from '../../src/pages/MethodologyPage';

for (const mode of ['fixture', 'http'] as const) {
  it(`describes ${mode} data and estimates without attributing the other mode's behavior`, () => {
    const providers = createFixtureProviders();
    providers.mode = mode;
    const view = render(
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <MethodologyPage />
        </MemoryRouter>
      </DataContext.Provider>,
    );
    const pricing = view.container.querySelector('#pricing');
    const data = view.container.querySelector('#data');
    const limits = view.container.querySelector('#limits');
    const evidence = view.container.querySelector('#evidence');
    if (
      !(pricing instanceof HTMLElement) ||
      !(data instanceof HTMLElement) ||
      !(limits instanceof HTMLElement) ||
      !(evidence instanceof HTMLElement)
    )
      throw new Error('Missing methodology section');
    expect(screen.getByRole('heading', { name: 'What this deployment is running.' })).toBeVisible();
    if (mode === 'fixture') {
      expect(within(pricing).getByText(/synthetic monthly scenario placeholders/)).toBeVisible();
      expect(
        within(data).getByText(/every component, price, benchmark and compatibility/),
      ).toBeVisible();
      expect(limits).toHaveTextContent('There is no pricing feed');
      expect(pricing).toHaveTextContent('Unknown billing stays unpriced');
      expect(evidence).toHaveTextContent('Every item in this preview is unverified.');
    } else {
      expect(pricing).toHaveTextContent('configured API');
      expect(pricing).toHaveTextContent('does not independently verify');
      expect(pricing).toHaveTextContent('Unknown billing review coverage');
      expect(pricing).not.toHaveTextContent('never silently counted as zero');
      expect(pricing).not.toHaveTextContent(
        'amounts in this preview are synthetic monthly scenario placeholders',
      );
      expect(data).toHaveTextContent('This deployment uses a configured API');
      expect(data).not.toHaveTextContent(
        'every component, price, benchmark and compatibility result is synthetic',
      );
      expect(limits).not.toHaveTextContent('There is no pricing feed');
      expect(limits).toHaveTextContent('not proof of current billing');
      expect(evidence).not.toHaveTextContent('Every item in this preview is unverified.');
      expect(evidence).toHaveTextContent('Check the recorded status for each item.');
    }
    view.unmount();
  });
}
