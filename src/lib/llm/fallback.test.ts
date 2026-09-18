import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createFallbackProvider, resetCooldownsForTests } from './fallback.ts';
import { configuredModels, DEFAULT_MODELS } from './index.ts';
import { collect, type LlmProvider } from './types.ts';

/** A provider that answers with `chunks`, or throws `fail` after `after` of them. */
function fake(
  model: string,
  chunks: string[],
  fail?: { error: Error; after: number },
): LlmProvider & { calls: number } {
  const provider = {
    id: 'fake',
    model,
    calls: 0,
    async *stream() {
      provider.calls += 1;
      for (let i = 0; i < chunks.length; i += 1) {
        if (fail && i === fail.after) throw fail.error;
        yield chunks[i]!;
      }
      if (fail && fail.after >= chunks.length) throw fail.error;
    },
  };
  return provider;
}

const ask = (provider: LlmProvider, signal?: AbortSignal) =>
  collect(provider.stream({ messages: [{ role: 'user', content: '?' }], signal }));

const down = () => ({ error: new Error('401 unauthorized'), after: 0 });

beforeEach(() => {
  resetCooldownsForTests();
});

test('the first model answers when it can, and is named as the author', async () => {
  const llm = createFallbackProvider([fake('cloud', ['a', 'b']), fake('local', ['x'])]);
  assert.equal(await ask(llm), 'ab');
  assert.equal(llm.model, 'cloud');
  assert.deepEqual(llm.models, ['cloud', 'local']);
});

test('a model that fails before answering hands over to the next', async () => {
  const llm = createFallbackProvider([fake('cloud', ['a'], down()), fake('local', ['x'])]);
  assert.equal(await ask(llm), 'x');
  // Attribution follows the answer: a translation written now says qwen, not glm.
  assert.equal(llm.model, 'local');
});

test('a failure mid-answer is thrown, not spliced onto a second model', async () => {
  const local = fake('local', ['x']);
  const llm = createFallbackProvider([
    fake('cloud', ['a', 'b'], { error: new Error('reset'), after: 1 }),
    local,
  ]);
  await assert.rejects(ask(llm), /reset/);
  assert.equal(local.calls, 0);
});

test('an abort is the caller stopping, never a reason to fall back', async () => {
  const controller = new AbortController();
  controller.abort();
  const local = fake('local', ['x']);
  const llm = createFallbackProvider([fake('cloud', [], down()), local]);
  await assert.rejects(ask(llm, controller.signal), /401/);
  assert.equal(local.calls, 0);
});

test('a model that just failed is skipped until its cooldown ends', async () => {
  let clock = 0;
  const cloud = fake('cloud', ['a'], down());
  const make = () =>
    createFallbackProvider([cloud, fake('local', ['x'])], { cooldownMs: 1000, now: () => clock });

  await ask(make());
  assert.equal(cloud.calls, 1);
  // Shared across providers: the next caller does not pay for the dead model.
  await ask(make());
  assert.equal(cloud.calls, 1);
  clock = 1001;
  await ask(make());
  assert.equal(cloud.calls, 2);
});

test('when every model fails the last error is the one reported', async () => {
  const llm = createFallbackProvider([
    fake('cloud', [], down()),
    fake('local', [], { error: new Error('連不上 Ollama'), after: 0 }),
  ]);
  await assert.rejects(ask(llm), /連不上 Ollama/);
});

test('the model list comes from YOMU_LLM_MODELS, and the old variable is not read', () => {
  assert.deepEqual(configuredModels({}), DEFAULT_MODELS);
  assert.deepEqual(DEFAULT_MODELS, ['glm-5.3-flash:cloud', 'qwen3.8:27b']);
  assert.deepEqual(configuredModels({ YOMU_LLM_MODELS: ' a:1 , b ,' }), ['a:1', 'b']);
  assert.deepEqual(configuredModels({ YOMU_LLM_MODEL: 'qwen3.8:27b' }), DEFAULT_MODELS);
});

const structured = (provider: LlmProvider) =>
  collect(
    provider.stream({
      messages: [{ role: 'user', content: '?' }],
      format: { type: 'object' },
    }),
  );

test('a structured request falls back when the reply is prose, not JSON', async () => {
  let clock = 0;
  const cloud = fake('cloud', ['Let me analyze', ' this…']);
  const llm = createFallbackProvider([cloud, fake('local', ['{"a":', '1}'])], {
    now: () => clock,
  });
  assert.equal(await structured(llm), '{"a":1}');
  assert.equal(llm.model, 'local');
  // The model is up, so it is not put on cooldown: prose questions still go to it.
  assert.equal(await ask(llm), 'Let me analyze this…');
  assert.equal(cloud.calls, 2);
});

test('when no model manages JSON the last reply comes back rather than an error', async () => {
  const llm = createFallbackProvider([fake('cloud', ['nope']), fake('local', ['still no'])]);
  assert.equal(await structured(llm), 'still no');
  assert.equal(llm.model, 'local');
});
