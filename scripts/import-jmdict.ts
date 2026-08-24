/**
 * Imports `data/` into the database: JMdict entries, their forms and senses,
 * the frequency band from the XML, and then the link from every lexeme the
 * analyzer has produced to the entry it matches.
 *
 * Run: npm run db:jmdict   (after npm run data:jmdict)
 *
 * The whole thing is one transaction, and it is a full rebuild rather than an
 * incremental update -- JMdict has no change feed, so "what moved" is not
 * knowable. Chinese glosses survive the rebuild: sense ids are derived from
 * (entry, position) rather than generated, so a translation can be carried
 * across and reattached instead of being thrown away with the row it was on.
 */

import { closeSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { db, sqlite } from '../src/db/client.ts';
import {
  dictEntries,
  dictForms,
  dictSenses,
  lexemes,
} from '../src/db/schema.ts';
import {
  ObjectScanner,
  entryBand,
  parseEntry,
  type ParsedEntry,
  type SimplifiedWord,
} from '../src/lib/dict/jmdict.ts';
import {
  dictionaryMatchReport,
  linkLexemes,
  type LinkStats,
} from '../src/lib/dict/match.ts';

const SIMPLIFIED = 'data/jmdict-eng.json';
const XML = 'data/JMdict_e.xml';

/** Rows per INSERT. Keeps the widest table clear of SQLite's variable limit. */
const CHUNK = 200;

/**
 * Reads a file in chunks, synchronously.
 *
 * Synchronously on purpose: better-sqlite3's transactions cannot await, so a
 * streaming read and a single transaction are only compatible if the reading is
 * blocking too. The alternative is holding every parsed entry in memory until
 * the file is done, which is the thing streaming was for.
 */
function forEachChunk(path: string, onChunk: (text: string) => void): void {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(4 << 20);
    const decoder = new StringDecoder('utf8');
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      onChunk(decoder.write(buffer.subarray(0, read)));
    }
    const tail = decoder.end();
    if (tail !== '') onChunk(tail);
  } finally {
    closeSync(fd);
  }
}

/** entry id -> nf band. The single pass the XML exists for. */
function readBands(): Map<string, number> {
  const bands = new Map<string, number>();
  let carry = '';
  forEachChunk(XML, (chunk) => {
    const text = carry + chunk;
    const parts = text.split('</entry>');
    carry = parts.pop() ?? '';
    for (const part of parts) {
      const found = entryBand(part);
      if (found?.band != null) bands.set(found.id, found.band);
    }
  });
  return bands;
}

function report(label: string, stats: LinkStats): void {
  const matched = stats.lemmaReading + stats.lemmaOnly;
  const pct = (n: number) =>
    stats.considered === 0
      ? '     -'
      : `${((n / stats.considered) * 100).toFixed(1)}%`.padStart(6);

  process.stdout.write(
    `  ${stats.considered} ${label}\n` +
      `${pct(stats.lemmaReading)}  matched on lemma+reading (${stats.lemmaReading})\n` +
      `${pct(stats.ambiguous)}   ...of those, ambiguous  (${stats.ambiguous})\n` +
      `${pct(stats.lemmaOnly)}  matched on lemma only     (${stats.lemmaOnly})\n` +
      `${pct(stats.unmatched)}  unmatched                 (${stats.unmatched})\n` +
      `${pct(matched)}  matched overall           (${matched})\n`,
  );
}

function main(): void {
  const started = Date.now();

  process.stdout.write('reading frequency bands from the XML…\n');
  const bands = readBands();
  process.stdout.write(`  ${bands.size} entries carry an nf band\n`);

  db.transaction((tx) => {
    // Chinese glosses are the one thing in these tables the source files cannot
    // reproduce, so they are lifted out before the rebuild and put back after.
    const translated = tx
      .select({
        id: dictSenses.id,
        glossZh: dictSenses.glossZh,
        glossModel: dictSenses.glossModel,
      })
      .from(dictSenses)
      .all()
      .filter((row) => row.glossZh !== null);
    if (translated.length > 0) {
      process.stdout.write(`  carrying ${translated.length} translated senses\n`);
    }
    const zh = new Map(translated.map((row) => [row.id, row]));

    // Lexemes point at entries about to be deleted, and the rebuild re-links
    // them at the end anyway.
    tx.update(lexemes).set({ dictEntryId: null, dictMatch: null }).run();
    tx.delete(dictSenses).run();
    tx.delete(dictForms).run();
    tx.delete(dictEntries).run();

    process.stdout.write('importing entries…\n');

    let entryRows: Array<typeof dictEntries.$inferInsert> = [];
    let formRows: Array<typeof dictForms.$inferInsert> = [];
    let senseRows: Array<typeof dictSenses.$inferInsert> = [];
    let entries = 0;
    let senses = 0;
    let forms = 0;

    /**
     * Entries first, then the rows that reference them -- forms and senses
     * outnumber entries several times over, so flushing on their own count
     * would try to insert a form whose entry is still sitting in the buffer.
     */
    const flush = (force: boolean) => {
      if (entryRows.length < CHUNK && !(force && entryRows.length > 0)) return;

      tx.insert(dictEntries).values(entryRows).run();
      for (let i = 0; i < formRows.length; i += CHUNK) {
        tx.insert(dictForms).values(formRows.slice(i, i + CHUNK)).run();
      }
      for (let i = 0; i < senseRows.length; i += CHUNK) {
        tx.insert(dictSenses).values(senseRows.slice(i, i + CHUNK)).run();
      }
      entryRows = [];
      formRows = [];
      senseRows = [];
    };

    const take = (entry: ParsedEntry) => {
      entries++;
      entryRows.push({
        id: entry.id,
        freqBand: bands.get(entry.id) ?? null,
        common: entry.common,
        headword: entry.headword,
        reading: entry.reading,
      });
      for (const form of entry.forms) {
        forms++;
        formRows.push({ entryId: entry.id, text: form.text, reading: form.reading });
      }
      entry.senses.forEach((sense, index) => {
        senses++;
        // Derived, not generated: this id is what lets a Phase C translation
        // survive the next full rebuild of the dictionary.
        const id = `${entry.id}:${index}`;
        const carried = zh.get(id);
        senseRows.push({
          id,
          entryId: entry.id,
          orderIndex: index,
          pos: sense.pos,
          glossEn: sense.glossEn,
          glossZh: carried?.glossZh ?? null,
          glossModel: carried?.glossModel ?? null,
        });
      });
      flush(false);
    };

    const scanner = new ObjectScanner('"words":');
    forEachChunk(SIMPLIFIED, (chunk) => {
      for (const text of scanner.push(chunk)) {
        const parsed = parseEntry(JSON.parse(text) as SimplifiedWord);
        if (parsed) take(parsed);
      }
    });
    flush(true);

    process.stdout.write(
      `  ${entries} entries, ${forms} lookup forms, ${senses} senses\n`,
    );

    process.stdout.write('\nmatching lexemes…\n');
    linkLexemes(tx, { relink: true });

    // Reported over the Dictionary's own set rather than every lexeme: the
    // characters 。、「」 are lexemes too, and no rate that counts them is
    // measuring how well matching works.
    report('content words the Dictionary lists', dictionaryMatchReport(tx));
  });

  process.stdout.write(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  sqlite.close();
}

main();
