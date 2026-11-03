import { describe, expect, it, vi } from 'vitest';
import { evaluateBuild } from '../../src/data/evaluation-evidence';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { apiChat, NOW } from './scenarios';

describe('evaluation report admission', () => {
  it.each([false, true])('uses the request-time build and locks (foreign: %s)', async (foreign) => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const original = await providers.compatibility.evaluate(build);
    let resolveReport: ((value: typeof original) => void) | undefined;
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReport = resolve;
        }),
    );
    const pending = evaluateBuild(providers.compatibility, build);
    build.id = 'build.changed';
    build.revision += 1;
    build.locks.ruleset_id = 'ruleset.changed';
    if (!resolveReport) throw new Error('Evaluation was not requested');
    resolveReport(
      foreign
        ? {
            ...original,
            build_id: build.id,
            build_revision: build.revision,
            ruleset_id: build.locks.ruleset_id,
          }
        : original,
    );
    if (foreign)
      await expect(pending).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'EvaluationReport',
      });
    else await expect(pending).resolves.toEqual(original);
  });
});
