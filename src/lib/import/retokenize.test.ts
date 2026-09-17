import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-test-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { sections, sentences, tokens } = await import('../../db/schema.ts');
const { ingestWork } = await import('./ingest.ts');
const { misalignedSections, retokenizeSection } = await import('./retokenize.ts');
const { parseEpub } = await import('../epub/epub.ts');
const { buildEpub } = await import('../epub/fixture.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const texts = (sectionId: string) =>
  db
    .select({ id: sentences.id, text: sentences.text })
    .from(sentences)
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(sentences.orderIndex)
    .all();

test('repairs a section the old analyzer misaligned, keeping the bookmark', async () => {
  const book = parseEpub(
    buildEpub({
      documents: [
        {
          name: 'p-001.xhtml',
          body: '<p>あくまでも〝補佐〟。基本は何も変わらない。</p><p>次の段落。</p>',
        },
      ],
    }),
  );
  const { sectionIds } = await ingestWork(book);
  const sectionId = sectionIds[0]!;
  const [first, merged, second] = texts(sectionId);

  // What the old import wrote: the grouped 〟。 did not end the first sentence,
  // and the next opens with the newline before it and is short its own 。, its
  // tokens a character early against that text.
  sqlite.prepare('delete from sentence where id = ?').run(merged!.id);
  sqlite
    .prepare("update sentence set text = 'あくまでも〝補佐〟。基本は何も変わらない' where id = ?")
    .run(first!.id);
  sqlite
    .prepare("update sentence set text = char(10) || '次の段落' where id = ?")
    .run(second!.id);
  sqlite
    .prepare('update token set char_start = char_start - 1, char_end = char_end - 1 where sentence_id = ?')
    .run(second!.id);
  db.update(sections).set({ progressSentenceId: second!.id }).where(eq(sections.id, sectionId)).run();

  const healthy = (
    await ingestWork({ title: '無事', sourceType: 'paste', sections: [{ body: '図書館へ行く。' }] })
  ).sectionIds[0]!;

  assert.deepEqual(misalignedSections(), [sectionId]);

  await retokenizeSection(sectionId);

  const repaired = texts(sectionId);
  assert.deepEqual(
    repaired.map((s) => s.text),
    ['あくまでも〝補佐〟。', '基本は何も変わらない。', '次の段落。'],
  );
  assert.deepEqual(misalignedSections(), []);
  assert.ok(!misalignedSections().includes(healthy));

  const rows = db
    .select({ text: sentences.text, surface: tokens.surface, charStart: tokens.charStart, charEnd: tokens.charEnd })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(eq(sentences.sectionId, sectionId))
    .all();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.text.slice(row.charStart, row.charEnd), row.surface);
  }

  // The bookmark was on 次の段落, and follows it to the new row.
  const section = db.select().from(sections).where(eq(sections.id, sectionId)).get();
  assert.equal(section?.progressSentenceId, repaired[2]!.id);
  assert.notEqual(section?.resolvedAt, null, 'a settled section was reopened');
});
