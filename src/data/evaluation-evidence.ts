import type { BuildSnapshot, EvaluationReport } from '../contracts';
import { matchesBuildEvidence } from './evidence-context';
import { DataError } from './errors';
import type { CompatibilityEvaluator, EvaluationEvidence } from './types';

/** Admit reports only for the build and artifacts captured when evaluation was requested. */
export async function evaluateBuild(
  evaluator: CompatibilityEvaluator,
  build: BuildSnapshot,
  evidence?: EvaluationEvidence,
): Promise<EvaluationReport> {
  const context = { id: build.id, revision: build.revision, locks: { ...build.locks } };
  const report = evidence
    ? await evaluator.evaluate(build, evidence)
    : await evaluator.evaluate(build);
  const locks = context.locks;
  if (
    !matchesBuildEvidence(context, report) ||
    report.catalog_snapshot_id !== locks.catalog_snapshot_id ||
    report.ruleset_id !== locks.ruleset_id ||
    report.ruleset_version !== locks.ruleset_version ||
    report.dependency_graph_id !== locks.dependency_graph_id ||
    report.dependency_graph_revision !== locks.dependency_graph_revision
  ) {
    throw new DataError(
      'malformed',
      'Evaluation report does not match the build or its pinned artifacts.',
      {
        contract: 'EvaluationReport',
      },
    );
  }
  return report;
}
