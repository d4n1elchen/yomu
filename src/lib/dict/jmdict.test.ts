import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ObjectScanner,
  entryBand,
  entryForms,
  parseEntry,
  type SimplifiedWord,
} from './jmdict.ts';

function word(overrides: Partial<SimplifiedWord> = {}): SimplifiedWord {
  return {
    id: '1000000',
    kanji: [],
    kana: [],
    sense: [],
    ...overrides,
  };
}

const kanji = (text: string, common = true, tags: string[] = []) => ({
  text,
  common,
  tags,
});

const kana = (
  text: string,
  appliesToKanji: string[] = ['*'],
  common = true,
  tags: string[] = [],
) => ({ text, common, tags, appliesToKanji });

test('entryForms pairs every spelling with every reading that applies', () => {
  const forms = entryForms(
    word({ kanji: [kanji('眺める')], kana: [kana('ながめる')] }),
  );
  assert.deepEqual(forms, [
    // The kana is a written form in its own right, not only a reading.
    { text: 'ながめる', reading: 'ながめる' },
    { text: '眺める', reading: 'ながめる' },
  ]);
});

test('entryForms honours appliesToKanji rather than cross-producing', () => {
  // 人気 is にんき and ひとけ; pairing both readings with both spellings would
  // be the homograph confusion the reading is meant to resolve.
  const forms = entryForms(
    word({
      kanji: [kanji('人気'), kanji('活気')],
      kana: [kana('にんき', ['人気']), kana('かっき', ['活気'])],
    }),
  );
  assert.deepEqual(
    forms.filter((f) => f.text === '人気'),
    [{ text: '人気', reading: 'にんき' }],
  );
  assert.deepEqual(
    forms.filter((f) => f.text === '活気'),
    [{ text: '活気', reading: 'かっき' }],
  );
});

test('entryForms folds katakana readings to hiragana', () => {
  // Loanwords are listed in katakana on JMdict's side and reported in katakana
  // by the analyzer, so neither side may be trusted to be hiragana already.
  const forms = entryForms(word({ kana: [kana('コーヒー', [])] }));
  assert.deepEqual(forms, [{ text: 'コーヒー', reading: 'こーひー' }]);
});

test('entryForms drops search-only spellings and readings', () => {
  const forms = entryForms(
    word({
      kanji: [kanji('会う'), kanji('逢ふ', false, ['sK'])],
      kana: [kana('あう'), kana('あふ', ['*'], false, ['sk'])],
    }),
  );
  assert.deepEqual(forms.map((f) => f.text).sort(), ['あう', '会う']);
});

test('parseEntry prefers the common spelling and reading as the headword', () => {
  const parsed = parseEntry(
    word({
      kanji: [kanji('彼処', false), kanji('何処', true)],
      kana: [kana('あすこ', ['*'], false), kana('あそこ', ['*'], true)],
      sense: [
        {
          partOfSpeech: ['pn'],
          gloss: [
            { lang: 'eng', text: 'there' },
            { lang: 'eng', text: 'over there' },
          ],
        },
      ],
    }),
  );
  assert.equal(parsed?.headword, '何処');
  assert.equal(parsed?.reading, 'あそこ');
  assert.deepEqual(parsed?.senses, [{ pos: 'pn', glossEn: 'there; over there' }]);
});

test('parseEntry makes a kana-only word its own headword', () => {
  const parsed = parseEntry(
    word({
      kana: [kana('そして', [])],
      sense: [{ partOfSpeech: ['conj'], gloss: [{ lang: 'eng', text: 'and' }] }],
    }),
  );
  assert.equal(parsed?.headword, 'そして');
  assert.equal(parsed?.reading, 'そして');
});

test('parseEntry drops senses that have no English gloss', () => {
  const parsed = parseEntry(
    word({
      kana: [kana('てすと', [])],
      sense: [
        { partOfSpeech: ['n'], gloss: [{ lang: 'ger', text: 'Test' }] },
        { partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'test' }] },
      ],
    }),
  );
  assert.deepEqual(parsed?.senses, [{ pos: 'n', glossEn: 'test' }]);
});

test('entryBand takes the lowest nf across an entry, from either element', () => {
  const xml = `
    <ent_seq>1578850</ent_seq>
    <k_ele><keb>行く</keb><ke_pri>news1</ke_pri><ke_pri>nf07</ke_pri></k_ele>
    <r_ele><reb>いく</reb><re_pri>nf12</re_pri></r_ele>`;
  assert.deepEqual(entryBand(xml), { id: '1578850', band: 7 });
});

test('entryBand reports null for an entry outside the top 24,000', () => {
  const xml = '<ent_seq>2000001</ent_seq><k_ele><keb>齷齪</keb></k_ele>';
  assert.deepEqual(entryBand(xml), { id: '2000001', band: null });
});

const DOCUMENT = `{"version":"3.6.2","tags":{"n":"noun"},"words":[
  {"id":"1","gloss":"a { brace } in a string"},
  {"id":"2","gloss":"an escaped \\" quote, then }"},
  {"id":"3","nested":{"deep":{"deeper":true}}}
]}`;

test('ObjectScanner finds whole entries past the document header', () => {
  const scanner = new ObjectScanner('"words":');
  const found = scanner.push(DOCUMENT);
  assert.equal(found.length, 3);
  assert.deepEqual(
    found.map((text) => (JSON.parse(text) as { id: string }).id),
    ['1', '2', '3'],
  );
});

test('ObjectScanner is unaffected by where the chunks are cut', () => {
  // The real file arrives in 4 MB reads, so an entry -- and the "words" marker
  // itself -- straddles a boundary. One character at a time is the worst case.
  for (const size of [1, 2, 7, 33, 64]) {
    const scanner = new ObjectScanner('"words":');
    const found: string[] = [];
    for (let i = 0; i < DOCUMENT.length; i += size) {
      found.push(...scanner.push(DOCUMENT.slice(i, i + size)));
    }
    assert.deepEqual(
      found.map((text) => (JSON.parse(text) as { id: string }).id),
      ['1', '2', '3'],
      `chunk size ${size}`,
    );
  }
});

test('ObjectScanner ignores braces inside strings and their escapes', () => {
  const scanner = new ObjectScanner('"words":');
  const [, second] = scanner.push(DOCUMENT);
  assert.equal(
    (JSON.parse(second!) as { gloss: string }).gloss,
    'an escaped " quote, then }',
  );
});
