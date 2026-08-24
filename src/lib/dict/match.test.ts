import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The db client resolves its path at import time, so point it at a scratch
// database before anything pulls it in.
const dir = mkdtempSync(path.join(tmpdir(), 'yomu-match-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { dictEntries, dictForms, dictSenses, lexemes } = await import(
  '../../db/schema.ts'
);
const { linkLexemes, matchLexeme } = await import('./match.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

/** A JMdict entry: its lookup forms, and the POS tags of its senses. */
function entry(options: {
  id: string;
  band?: number | null;
  common?: boolean;
  headword: string;
  reading: string;
  forms: Array<[string, string]>;
  pos: string;
}) {
  const { id, band = null, common = true, headword, reading, forms, pos } = options;
  db.insert(dictEntries).values({ id, freqBand: band, common, headword, reading }).run();
  db.insert(dictForms)
    .values(forms.map(([text, r]) => ({ entryId: id, text, reading: r })))
    .run();
  db.insert(dictSenses)
    .values({ id: `${id}:0`, entryId: id, orderIndex: 0, pos, glossEn: headword })
    .run();
}

/** kuromoji's output shape: readings in katakana, always. */
function lexeme(
  id: string,
  lemma: string,
  reading: string,
  pos = '名詞',
  posDetail: string | null = null,
  conjugationType: string | null = null,
) {
  db.insert(lexemes)
    .values({ id, dictionary: 'ipadic', lemma, reading, pos, posDetail, conjugationType })
    .run();
}

/** IPADIC's grammar for a token, as `matchLexeme` wants it. */
const noun = { pos: '名詞', posDetail: null, conjugationType: null };
const ichidan = { pos: '動詞', posDetail: '自立', conjugationType: '一段' };
const godanRa = { pos: '動詞', posDetail: '自立', conjugationType: '五段・ラ行' };

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });

  entry({
    id: '1',
    band: 12,
    headword: '眺める',
    reading: 'ながめる',
    forms: [
      ['眺める', 'ながめる'],
      ['ながめる', 'ながめる'],
    ],
    pos: 'v1,vt',
  });
  // 人気 is two words sharing a spelling. にんき is far commoner, and the band
  // is what breaks the tie when only the lemma is known.
  entry({
    id: '2',
    band: 4,
    headword: '人気',
    reading: 'にんき',
    forms: [['人気', 'にんき']],
    pos: 'n',
  });
  entry({
    id: '3',
    band: 40,
    headword: '人気',
    reading: 'ひとけ',
    forms: [['人気', 'ひとけ']],
    pos: 'n',
  });
  entry({
    id: '4',
    headword: '珈琲',
    reading: 'こーひー',
    forms: [
      ['珈琲', 'こーひー'],
      ['コーヒー', 'こーひー'],
    ],
    pos: 'n',
  });
  // 入る and 居る are both いる, both flagged common, and neither is ranked.
  // Lemma and reading cannot separate them; the conjugation class can.
  entry({ id: '5', headword: '入る', reading: 'いる', forms: [['いる', 'いる']], pos: 'v5r,vi' });
  entry({ id: '6', headword: '居る', reading: 'いる', forms: [['いる', 'いる']], pos: 'v1,vi' });
  // Ranked but well down the corpus, against an unranked common word.
  entry({
    id: '7',
    band: 30,
    common: false,
    headword: '射る',
    reading: 'いろ',
    forms: [['いろ', 'いろ']],
    pos: 'v1,vt',
  });
  entry({ id: '8', headword: '色', reading: 'いろ', forms: [['いろ', 'いろ']], pos: 'n' });
  // さん: the honorific suffix against the numeral, which is band 1 and would
  // win every tiebreak that did not look at grammar.
  entry({
    id: '9',
    band: 1,
    headword: '三',
    reading: 'さん',
    forms: [['さん', 'さん']],
    pos: 'num',
  });
  entry({ id: '10', headword: 'さん', reading: 'さん', forms: [['さん', 'さん']], pos: 'suf' });
});

after(() => {
  // Windows will not unlink a database file while the handle is open.
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('matches on lemma and reading, folding katakana to hiragana', () => {
  // The analyzer says ナガメル; JMdict says ながめる. Neither side is trusted to
  // already be in the other's script.
  assert.deepEqual(matchLexeme('眺める', 'ナガメル', ichidan), {
    entryId: '1',
    kind: 'lemma_reading',
  });
});

test('the reading picks the right homograph', () => {
  assert.deepEqual(matchLexeme('人気', 'ヒトケ', noun), {
    entryId: '3',
    kind: 'lemma_reading',
  });
  assert.deepEqual(matchLexeme('人気', 'ニンキ', noun), {
    entryId: '2',
    kind: 'lemma_reading',
  });
});

test('conjugation class settles what the reading could not', () => {
  // Both entries are いる, both common, neither ranked. IPADIC saw the token
  // conjugate 一段, and only 居る is v1.
  assert.deepEqual(matchLexeme('いる', 'イル', ichidan), {
    entryId: '6',
    kind: 'lemma_reading',
  });
  assert.deepEqual(matchLexeme('いる', 'イル', godanRa), {
    entryId: '5',
    kind: 'lemma_reading',
  });
});

test('a noun subtype beats a commoner entry of the wrong kind', () => {
  // 三 is band 1 and wins on frequency alone, but 綾辻さん's さん is a suffix.
  assert.deepEqual(
    matchLexeme('さん', 'サン', { pos: '名詞', posDetail: '接尾', conjugationType: null }),
    { entryId: '10', kind: 'lemma_reading' },
  );
  // Without the detail there is nothing to narrow on, so frequency decides.
  assert.deepEqual(matchLexeme('さん', 'サン', noun), {
    entryId: '9',
    kind: 'lemma_reading_multi',
  });
});

test('grammar that rules out everything is ignored rather than obeyed', () => {
  // No entry for いろ is an adjective. Dropping them all would lose a match
  // that lemma and reading had already earned, so the filter stands down.
  const match = matchLexeme('いろ', 'イロ', {
    pos: '形容詞',
    posDetail: '自立',
    conjugationType: '形容詞・アウオ段',
  });
  assert.equal(match?.kind, 'lemma_reading_multi');
  assert.equal(match?.entryId, '8');
});

test('an unranked common word beats a ranked obscure one', () => {
  // Ordering on the band alone would treat "no rank" as rank 999 and hand
  // every いろ to 射る.
  assert.deepEqual(matchLexeme('いろ', 'イロ', noun), {
    entryId: '8',
    kind: 'lemma_reading',
  });
});

test('a reading JMdict disagrees with falls back to the lemma', () => {
  assert.deepEqual(matchLexeme('人気', 'ジンキ', noun), {
    entryId: '2',
    kind: 'lemma',
  });
});

test('a word the analyzer has no reading for still matches on its lemma', () => {
  assert.deepEqual(matchLexeme('眺める', '', ichidan), { entryId: '1', kind: 'lemma' });
});

test('a katakana loanword matches its kana form', () => {
  assert.deepEqual(matchLexeme('コーヒー', 'コーヒー', noun), {
    entryId: '4',
    kind: 'lemma_reading',
  });
});

test('nothing in JMdict means no match, not a wrong one', () => {
  assert.equal(matchLexeme('Kubernetes', '', noun), null);
  assert.equal(matchLexeme('', 'ナガメル', noun), null);
});

test('linkLexemes writes the entry and how it was reached', () => {
  lexeme('lex-1', '眺める', 'ナガメル', '動詞', '自立', '一段');
  lexeme('lex-2', '人気', 'ジンキ');
  lexeme('lex-3', 'Kubernetes', '');

  const stats = linkLexemes(db);
  assert.deepEqual(stats, {
    considered: 3,
    lemmaReading: 1,
    ambiguous: 0,
    lemmaOnly: 1,
    unmatched: 1,
  });

  const rows = db
    .select({
      id: lexemes.id,
      entryId: lexemes.dictEntryId,
      match: lexemes.dictMatch,
    })
    .from(lexemes)
    .all();
  const by = new Map(rows.map((row) => [row.id, row]));

  assert.deepEqual(by.get('lex-1'), {
    id: 'lex-1',
    entryId: '1',
    match: 'lemma_reading',
  });
  assert.deepEqual(by.get('lex-2'), { id: 'lex-2', entryId: '2', match: 'lemma' });
  // Left null rather than recorded as a failure: an unmatched word is marked
  // hard precisely because nothing vouches for it.
  assert.deepEqual(by.get('lex-3'), { id: 'lex-3', entryId: null, match: null });
});

test('the analyzer hints stored on the lexeme are what reach the matcher', () => {
  // 入る (entry 5) sorts first without grammar -- same preference, lower id.
  // Landing on 居る proves the columns are read rather than defaulted away.
  //
  // One lexeme, not two: `posDetail` and `conjugationType` are deliberately
  // outside the identity key, so a second いる/イル/動詞 row cannot exist to
  // carry a different conjugation class.
  lexeme('lex-4', 'いる', 'イル', '動詞', '自立', '一段');

  linkLexemes(db);
  const linked = db.select().from(lexemes).where(eq(lexemes.id, 'lex-4')).get();
  assert.equal(linked?.dictEntryId, '6');
  assert.equal(linked?.dictMatch, 'lemma_reading');
});

test('linking again only considers rows that are still unlinked', () => {
  lexeme('lex-5', 'コーヒー', 'コーヒー');

  const stats = linkLexemes(db);
  // lex-3 is unmatched and therefore still unlinked, so it is retried; the
  // rows that did match are left alone.
  assert.equal(stats.considered, 2);
  assert.equal(stats.lemmaReading, 1);
  assert.equal(stats.unmatched, 1);
});

test('relink re-examines everything, including what already matched', () => {
  const stats = linkLexemes(db, { relink: true });
  assert.equal(stats.considered, 5);
  assert.equal(stats.unmatched, 1);
});

test('relink clears a model-resolution stamp along with the link it annotated', () => {
  // The stamp says the model chose this entry. Once relink recomputes the link
  // deterministically it no longer describes anything, so it must not survive to
  // mark a computed pick as model-made -- the resolver reads its absence as
  // "still to consider".
  db.update(lexemes)
    .set({ dictResolver: 'qwen3.8:27b' })
    .where(eq(lexemes.id, 'lex-1'))
    .run();

  linkLexemes(db, { relink: true });

  const linked = db.select().from(lexemes).where(eq(lexemes.id, 'lex-1')).get();
  assert.equal(linked?.dictResolver, null);
  assert.equal(linked?.dictEntryId, '1');
});
