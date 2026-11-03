import { expect, it } from 'vitest';
import { buildMarkdown } from '../../src/features/builder/BuildToolbar';
import { apiChat, BY_ID, item } from './scenarios';
import { validateContract, validatorsReady } from '../../src/contracts';

it('identifies a pinned version when the current catalog record differs', () => {
  const build = apiChat();
  build.selections = build.selections.map((selection) =>
    selection.id === 'sel_model'
      ? { ...selection, catalog_item_version: 'older-version' }
      : selection,
  );
  const markdown = buildMarkdown(build, BY_ID, 'fixture');
  expect(markdown).toContain('selected version: older-version');
  expect(markdown).toContain(`current catalog version: ${item('model', 'aurora-large').version}`);
});

it('keeps build and catalog text literal inside Markdown headings and table cells', async () => {
  await validatorsReady;
  const build = apiChat();
  build.name = 'My *build*\n# forged heading';
  const model = build.selections.find((selection) => selection.kind === 'model');
  if (!model) throw new Error('Missing model');
  model.catalog_item_version = 'old | [link](https://example.com)';
  const catalogItem = {
    ...item('model', 'aurora-large'),
    name: 'Model | [link](https://example.com) <b>bold</b> & text',
  };
  expect(validateContract('BuildSnapshot', build).ok).toBe(true);
  expect(validateContract('CatalogItem', catalogItem).ok).toBe(true);
  const catalog = new Map(BY_ID);
  catalog.set(model.catalog_item_id, catalogItem);
  const markdown = buildMarkdown(build, catalog, 'fixture');
  expect(markdown).toContain('# My \\*build\\* \\# forged heading\n');
  expect(markdown).not.toContain('\n# forged heading');
  const modelLine = markdown.split('\n').find((line) => line.startsWith('| AI Model |'));
  expect(modelLine).toContain(
    'Model \\| \\[link\\](https\\://example.com) &lt;b&gt;bold&lt;/b&gt; &amp; text',
  );
  expect(modelLine).toContain('selected version: old \\| \\[link\\](https\\://example.com)');
});

it('does not label a selection using a different-kind catalog record', () => {
  const build = apiChat();
  const model = build.selections.find((selection) => selection.kind === 'model');
  if (!model) throw new Error('Missing model');
  const wrong = {
    ...item('workload', 'document-qa'),
    id: model.catalog_item_id,
    version: model.catalog_item_version,
  };
  const catalog = new Map(BY_ID);
  catalog.set(model.catalog_item_id, wrong);
  const markdown = buildMarkdown(build, catalog, 'fixture');
  const modelLine = markdown.split('\n').find((line) => line.startsWith('| AI Model |'));
  expect(modelLine).toContain('demo.model.aurora-large');
  expect(modelLine).toContain('not in current catalog');
  expect(modelLine).not.toContain(wrong.name);
  expect(modelLine).not.toContain('synthetic');
});

it('keeps URLs, email addresses and backslashes as literal text', () => {
  const build = apiChat();
  build.name = 'https://example.com www.example.com a@example.com \\|';
  expect(buildMarkdown(build, BY_ID, 'fixture')).toContain(
    '# https\\://example.com www\\.example.com a\\@example.com \\\\\\|\n',
  );
});

it('retains heading markers and strikethrough characters as text', () => {
  const build = apiChat();
  build.name = 'Title ~~draft~~ #';
  expect(buildMarkdown(build, BY_ID, 'fixture')).toContain('# Title \\~\\~draft\\~\\~ \\#\n');
});

it('labels synthetic catalog items in HTTP mode without calling the whole export demo data', () => {
  const build = apiChat();
  const catalog = new Map(
    [...BY_ID].map(([id, entry]) => [
      id,
      { ...entry, tags: (entry.tags ?? []).filter((tag) => tag !== 'synthetic') },
    ]),
  );
  const model = build.selections.find((selection) => selection.kind === 'model');
  if (!model) throw new Error('Missing model');
  const synthetic = catalog.get(model.catalog_item_id);
  if (!synthetic) throw new Error('Missing catalog item');
  catalog.set(model.catalog_item_id, { ...synthetic, tags: ['synthetic'] });
  const markdown = buildMarkdown(build, catalog, 'http');
  const modelLine = markdown.split('\n').find((line) => line.startsWith('| AI Model |'));
  expect(modelLine).toContain('synthetic');
  expect(markdown).not.toContain('Demo components, prices and results are synthetic');
  expect(markdown.split('\n').filter((line) => line.includes('synthetic'))).toHaveLength(1);
});

it('identifies a synthetic current catalog record separately from an older pinned version', () => {
  const build = apiChat();
  const model = build.selections.find((selection) => selection.kind === 'model');
  if (!model) throw new Error('Missing model');
  model.catalog_item_version = 'older-version';
  const markdown = buildMarkdown(build, BY_ID, 'http');
  const modelLine = markdown.split('\n').find((line) => line.startsWith('| AI Model |'));
  expect(modelLine).toContain('current catalog record is synthetic');
  expect(modelLine).toContain('selected version: older-version');
});

it('retains a clear synthetic-data footer in fixture mode', () => {
  expect(buildMarkdown(apiChat(), BY_ID, 'fixture')).toContain(
    'Demo components, prices and results are synthetic',
  );
});
