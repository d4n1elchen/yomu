import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { LlmProvider } from '../llm/types.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-translation-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');
const { db, sqlite } = await import('../../db/client.ts');
const { dictEntries, dictSenses, lexemes } = await import('../../db/schema.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { translatePending, pendingTranslationCount } = await import('./translate.ts');
migrate(db, { migrationsFolder: './drizzle' });
after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('rejected batches do not starve later entries or restart on page polling', async () => {
  for (let i = 0; i < 6; i++) {
    const id = String(i);
    db.insert(dictEntries).values({ id, headword: id, reading: id }).run();
    db.insert(dictSenses).values({
      id, entryId: id, orderIndex: 0, pos: 'n', glossEn: 'word',
    }).run();
    db.insert(lexemes).values({
      id, dictionary: 'test', lemma: id, reading: id, pos: 'n', dictEntryId: id,
    }).run();
  }
  let calls = 0;
  const provider: LlmProvider = {
    id: 'test', model: 'rejecting',
    async *stream() {
      calls++;
      // Reject the first full chunk on both attempts; the next entry succeeds.
      yield calls <= 10 ? '{"senses":["这"]}' : '{"senses":["詞語"]}';
    },
  };
  assert.deepEqual(await translatePending({ provider, limit: 5 }), {
    reached: true, translated: 0, exhausted: false,
  });
  assert.equal(calls, 10);
  assert.deepEqual(await translatePending({ provider, limit: 5 }), {
    reached: true, translated: 1, exhausted: true,
  });
  assert.equal(pendingTranslationCount(), 5, 'rejections retain their English fallback');
  assert.deepEqual(await translatePending({ provider, limit: 5 }), {
    reached: true, translated: 0, exhausted: true,
  });
  assert.equal(calls, 11, 'a later page refresh makes no more model calls');

  // Network errors must not poison the rejection set.
  let fail = true;
  const recovered: LlmProvider = {
    id: 'test', model: 'replacement',
    async *stream() {
      if (fail) throw new Error('offline');
      yield '{"senses":["詞語"]}';
    },
  };
  assert.equal((await translatePending({ provider: recovered })).reached, false);
  fail = false;
  assert.equal((await translatePending({ provider: recovered })).translated, 5);
  assert.equal(pendingTranslationCount(), 0);
});
