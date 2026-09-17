/**
 * Imports 「つつじ」 from `data/tsutsuji-1.1u.zip` into the grammar tables.
 *
 * Run: npm run db:tsutsuji   (after npm run data:tsutsuji)
 *
 * A full rebuild in one transaction, like the JMdict import: つつじ has no
 * change feed, so "what moved" is not knowable. The reviewed Chinese names and
 * glosses survive it -- they are keyed on the つつじ id, which is stable by
 * construction, so they are read back and reattached rather than regenerated.
 * Regenerating them would cost an hour of model time and a second review.
 *
 * Supplements (ids beginning `yomu:`) are not touched. They are hand-written,
 * they are not in the archive, and a rebuild must not delete them.
 */

import { readFile } from 'node:fs/promises';
import { eq, like, not, sql as raw } from 'drizzle-orm';
import { db, sqlite } from '../src/db/client.ts';
import {
  grammarConnections,
  grammarForms,
  grammarPoints,
} from '../src/db/schema.ts';
import { openZip } from '../src/lib/epub/zip.ts';
import { parseTsutsuji } from '../src/lib/grammar/tsutsuji.ts';

const ARCHIVE = 'data/tsutsuji-1.1u.zip';
const ROOT = 'tsutsuji-1.1u/';

/** Rows per INSERT, kept clear of SQLite's variable limit on the widest table. */
const CHUNK = 400;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

async function main(): Promise<void> {
  let archive: Buffer;
  try {
    archive = await readFile(ARCHIVE);
  } catch {
    throw new Error(`找不到 ${ARCHIVE}。請先執行 npm run data:tsutsuji。`);
  }

  const zip = openZip(archive);
  const parsed = parseTsutsuji({
    xml: zip.readText(`${ROOT}tsutsuji1.1.xml`),
    connectID: zip.readText(`${ROOT}connectID`),
    className: zip.readText(`${ROOT}className`),
  });

  process.stdout.write(
    `つつじ：${parsed.entries.length} 個句型、${parsed.patterns.length} 種寫法、` +
      `${Object.keys(parsed.connections).length} 個接續類別\n`,
  );

  // Every point つつじ describes must have a meaning class name, since that is
  // what the Chinese gloss is written from. A missing one is a data change
  // worth stopping for rather than importing half of.
  const unnamed = parsed.entries.filter(
    (entry) => !parsed.meaningNames[entry.meaningClass],
  );
  if (unnamed.length > 0) {
    throw new Error(
      `${unnamed.length} 個句型的意義分類在 className 中找不到名稱` +
        `（例如 ${unnamed[0]!.id}／${unnamed[0]!.meaningClass}）。` +
        `つつじ 可能已改版。`,
    );
  }

  const kept = db
    .select({
      id: grammarPoints.id,
      nameZh: grammarPoints.nameZh,
      glossZh: grammarPoints.glossZh,
      glossModel: grammarPoints.glossModel,
    })
    .from(grammarPoints)
    .all();
  const glosses = new Map(kept.map((row) => [row.id, row]));

  const written = db.transaction(() => {
    // Forms cascade from points; connections are replaced wholesale. Only the
    // つつじ rows go -- a `yomu:` supplement is not in this archive and stays.
    db.delete(grammarPoints).where(not(like(grammarPoints.id, 'yomu:%'))).run();
    db.delete(grammarConnections).run();

    for (const batch of chunks(parsed.entries)) {
      db.insert(grammarPoints)
        .values(
          batch.map((entry) => {
            const gloss = glosses.get(entry.id);
            return {
              id: entry.id,
              base: entry.base,
              difficulty: entry.difficulty,
              meaningClass: entry.meaningClass,
              meaningName: parsed.meaningNames[entry.meaningClass]!,
              nameZh: gloss?.nameZh ?? null,
              glossZh: gloss?.glossZh ?? null,
              glossModel: gloss?.glossModel ?? null,
            };
          }),
        )
        .run();
    }

    // つつじ lists a form once per spelling and conjugation, and two of those
    // can reduce to the same units with the same constraints. The table's key
    // makes that one row; `onConflictDoNothing` is what lets the import say so
    // rather than fail on the duplicate.
    for (const batch of chunks(parsed.patterns)) {
      db.insert(grammarForms)
        .values(
          batch.map((pattern) => ({
            pointId: pattern.entryId,
            units: pattern.units.join('.'),
            firstUnit: pattern.units[0]!,
            left: pattern.left,
            right: pattern.right,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    for (const batch of chunks(Object.entries(parsed.connections))) {
      db.insert(grammarConnections)
        .values(batch.map(([code, rows]) => ({ code, rows: rows.join(';') })))
        .run();
    }

    return {
      points: db
        .select({ n: raw<number>`count(*)` })
        .from(grammarPoints)
        .get()!.n,
      forms: db.select({ n: raw<number>`count(*)` }).from(grammarForms).get()!.n,
    };
  });

  const glossed = db
    .select({ n: raw<number>`count(*)` })
    .from(grammarPoints)
    .where(not(eq(grammarPoints.nameZh, '')))
    .get()!.n;

  process.stdout.write(
    `已匯入：${written.points} 個句型、${written.forms} 種寫法。\n` +
      `中文名稱已有 ${glossed} 個；其餘請執行 npm run db:grammar-gloss。\n`,
  );

  sqlite.close();
}

await main();
