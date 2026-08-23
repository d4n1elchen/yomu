import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignFurigana } from './furigana.ts';

const flat = (surface: string, reading: string | null) =>
  alignFurigana(surface, reading).map((s) => `${s.text}(${s.ruby ?? ''})`).join('');

test('splits a reading across kanji and okurigana', () => {
  assert.equal(flat('食べた', 'タベタ'), '食(た)べた()');
});

test('handles a leading kana run', () => {
  assert.equal(flat('お茶', 'オチャ'), 'お()茶(ちゃ)');
});

test('handles two kanji runs separated by okurigana', () => {
  assert.equal(flat('食べ歩き', 'タベアルキ'), '食(た)べ()歩(ある)き()');
});

test('keeps the iteration mark with its kanji', () => {
  assert.equal(flat('時々', 'トキドキ'), '時々(ときどき)');
});

test('annotates a bare kanji compound as one span', () => {
  assert.equal(flat('日本語', 'ニホンゴ'), '日本語(にほんご)');
});

test('leaves all-kana surfaces unannotated', () => {
  assert.equal(flat('ください', 'クダサイ'), 'ください()');
  assert.equal(flat('コーヒー', 'コーヒー'), 'コーヒー()');
});

test('leaves punctuation and digits unannotated', () => {
  assert.equal(flat('。', null), '。()');
  assert.equal(flat('2024', null), '2024()');
});

test('falls back to whole-token ruby when the reading is unknown', () => {
  // IPADIC gives no reading for many proper nouns.
  assert.equal(flat('綾辻', null), '綾辻()');
});

test('falls back to whole-token ruby when alignment is impossible', () => {
  // ヶ is katakana in the surface but voiced as か in the reading, so the
  // okurigana anchor cannot be located. Whole-token ruby, not a crash.
  assert.equal(flat('一ヶ月', 'イッカゲツ'), '一ヶ月(いっかげつ)');
});

test('does not annotate when the reading merely restates a kana surface', () => {
  assert.equal(flat('する', 'スル'), 'する()');
});

test('handles mixed latin and kanji without throwing', () => {
  const segments = alignFurigana('CD屋', 'シーディーヤ');
  assert.equal(segments.map((s) => s.text).join(''), 'CD屋');
});

test('reconstructs the surface exactly for every input', () => {
  const cases: Array<[string, string | null]> = [
    ['食べた', 'タベタ'],
    ['お茶', 'オチャ'],
    ['食べ歩き', 'タベアルキ'],
    ['時々', 'トキドキ'],
    ['一ヶ月', 'イッカゲツ'],
    ['引き受けて', 'ヒキウケテ'],
    ['綾辻', null],
    ['申し訳ありません', 'モウシワケアリマセン'],
  ];
  for (const [surface, reading] of cases) {
    const rebuilt = alignFurigana(surface, reading)
      .map((s) => s.text)
      .join('');
    assert.equal(rebuilt, surface, `lost characters in ${surface}`);
  }
});
