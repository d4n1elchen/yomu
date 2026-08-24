import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-dict-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../db/client.ts');
const { ingestWork } = await import('./import/ingest.ts');
const { listDictionary, getDictionaryEntry } = await import(
  './dictionary.ts'
);
const { dictEntries, dictForms, dictSenses } = await import('../db/schema.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

const find = (lemma: string) =>
  listDictionary().entries.find((e) => e.lemma === lemma);

before(async () => {
  migrate(db, { migrationsFolder: './drizzle' });
  await ingestWork({
    title: '読書',
    sourceType: 'paste',
    sections: [
      {
        body: [
          '昨日、図書館で本を三冊借りた。',
          'まだ半分しか読んでいない。',
          '来週までには全部読み終わるつもりだ。',
        ].join('\n'),
      },
    ],
  });
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('groups inflected forms under one entry with a total count', () => {
  const read = find('読む');
  assert.ok(read, '読む missing from the dictionary');
  assert.equal(read.occurrences, 2);
  assert.equal(read.reading, 'ヨム');
  assert.deepEqual([...read.forms].sort(), ['読み', '読ん']);
});

test('hides particles and auxiliaries from the default view', () => {
  const positions = new Set(listDictionary().entries.map((e) => e.pos));
  assert.equal(positions.has('助詞'), false);
  assert.equal(positions.has('助動詞'), false);
});

test('never lists punctuation as vocabulary', () => {
  for (const query of [{}, { pos: '記号' }]) {
    const entries = listDictionary(query).entries;
    assert.equal(
      entries.some((e) => e.lemma === '。' || e.pos === '記号'),
      false,
    );
  }
});

test('an explicit part of speech reveals the hidden ones', () => {
  const particles = listDictionary({ pos: '助詞' });
  assert.ok(particles.entries.length > 0, 'no particles found');
  assert.equal(
    particles.entries.every((e) => e.pos === '助詞'),
    true,
  );
});

test('facets still offer parts of speech the default view hides', () => {
  // Otherwise particles would be unreachable rather than merely hidden.
  const names = listDictionary().facets.map((f) => f.pos);
  assert.ok(names.includes('助詞'), '助詞 missing from facets');
});

test('search matches both the dictionary form and its reading', () => {
  assert.ok(listDictionary({ q: '読' }).entries.some((e) => e.lemma === '読む'));
  assert.ok(listDictionary({ q: 'ヨム' }).entries.some((e) => e.lemma === '読む'));
});

test('an entry lists every occurrence, each highlighting its own form', () => {
  const detail = getDictionaryEntry(find('読む')!.id);
  assert.ok(detail);
  assert.equal(detail.occurrences.length, 2);

  for (const occurrence of detail.occurrences) {
    // The offsets must select the inflected form actually used here.
    assert.equal(
      occurrence.sentenceText.slice(
        occurrence.charStart,
        occurrence.charEnd,
      ),
      occurrence.surface,
    );
    assert.equal(occurrence.workTitle, '読書');
  }
  assert.deepEqual(
    detail.occurrences.map((o) => o.surface).sort(),
    ['読み', '読ん'],
  );
});

test('unreviewed transcript words stay out of the dictionary until reviewed', async () => {
  await ingestWork({
    title: '書き起こし',
    sourceType: 'transcript',
    sections: [{ body: '幽霊語を発明した。', origin: 'transcript' }],
  });

  // A misheard word tokenizes as cleanly as a real one, so it must not become
  // vocabulary on the strength of an unread machine transcript.
  assert.equal(find('発明'), undefined);

  const withUnreviewed = listDictionary({ includeUnreviewed: true }).entries;
  assert.ok(withUnreviewed.some((e) => e.lemma === '発明'));
});

test('an entry seen only in unreviewed text reports no occurrences by default', () => {
  const hidden = listDictionary({ includeUnreviewed: true }).entries.find(
    (e) => e.lemma === '発明',
  )!;
  assert.equal(getDictionaryEntry(hidden.id)!.occurrences.length, 0);
  assert.equal(
    getDictionaryEntry(hidden.id, { includeUnreviewed: true })!.occurrences.length,
    1,
  );
});

test('spellings of one word share a row, and its occurrence count', async () => {
  // IPADIC's lemma keeps the spelling, so these arrive as three lexemes.
  // JMdict is the only thing that knows they are one word.
  db.insert(dictEntries)
    .values({ id: 'jm-1', freqBand: 5, common: true, headword: '分かる', reading: 'わかる' })
    .run();
  db.insert(dictForms)
    .values(
      ['分かる', '判る', '解る', 'わかる'].map((text) => ({
        entryId: 'jm-1',
        text,
        reading: 'わかる',
      })),
    )
    .run();
  db.insert(dictSenses)
    .values({
      id: 'jm-1:0',
      entryId: 'jm-1',
      orderIndex: 0,
      pos: 'v5r,vi',
      glossEn: 'to understand',
    })
    .run();

  await ingestWork({
    title: '表記ゆれ',
    sourceType: 'paste',
    sections: [{ body: '意味が分かる。\n意味が判る。\n意味が解る。' }],
  });

  const rows = listDictionary().entries.filter((entry) =>
    ['分かる', '判る', '解る'].includes(entry.lemma),
  );
  assert.equal(rows.length, 1, 'the three spellings should share one row');

  const [word] = rows;
  assert.equal(word!.occurrences, 3);
  // The spelling actually read most often heads the row -- JMdict's own
  // headword is no help for this, offering 迄 for まで and 積もり for つもり.
  assert.deepEqual([...word!.forms].sort(), ['判る', '分かる', '解る'].sort());

  // The row and the page behind it have to report the same number.
  const detail = getDictionaryEntry(word!.id);
  assert.equal(detail?.occurrences.length, 3);
});

test('a word JMdict never matched still stands on its own', () => {
  // Grouping falls back to the lexeme itself, so an unmatched word is not
  // pooled with every other unmatched word.
  const unmatched = listDictionary().entries.filter((e) => e.lemma === '図書館');
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0]!.occurrences, 1);
});
