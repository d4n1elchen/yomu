/**
 * The grammar inventory, read from the database once and kept.
 *
 * 435 points, ~16,600 forms and 117 connection classes: about a megabyte in
 * memory, and every sentence a reader asks about needs all of it. Reading it
 * per request would be one query per token; reading it once is a cache that
 * never goes stale within a process, because the only thing that rewrites these
 * tables is `npm run db:tsutsuji`, which is run from a shell and not while the
 * server is serving.
 *
 * The reader must work without it. A fresh clone has no `data/`, so it has no
 * grammar either, and the panel then shows no grammar rather than an error --
 * the same way the difficulty slider hides itself when JMdict has not been
 * imported.
 */

import { createHash } from 'node:crypto';
import { db } from '../../db/client.ts';
import {
  grammarConnections,
  grammarForms,
  grammarPoints,
} from '../../db/schema.ts';
import {
  compileInventory,
  type CompiledInventory,
  type ConnectionTable,
  type GrammarDifficulty,
  type GrammarEntry,
  type GrammarPattern,
} from './inventory.ts';

/** A point as the card shows it: the inventory's row plus its Chinese text. */
export interface GrammarPoint extends GrammarEntry {
  /** つつじ's Japanese name for the meaning class: 進行-継続-テイル類. */
  meaningName: string;
  /** Traditional Chinese, once generated and reviewed. Null until then. */
  nameZh: string | null;
  glossZh: string | null;
}

export interface GrammarLibrary {
  inventory: CompiledInventory;
  point(id: string): GrammarPoint | undefined;
  /** Other points that paraphrase this one -- から against ので. Never merged. */
  peers(id: string): GrammarPoint[];
  size: number;
  /**
   * A fingerprint of everything a sentence's analysis depends on here: the
   * points with their Chinese (which is what the model chooses by), the forms
   * and the connection rules. A re-import or a corrected gloss changes it, and
   * with it every cached analysis stops being used.
   */
  stamp: string;
}

let cached: GrammarLibrary | null = null;

export function loadGrammar(): GrammarLibrary {
  if (cached) return cached;

  const rows = db
    .select({
      id: grammarPoints.id,
      base: grammarPoints.base,
      difficulty: grammarPoints.difficulty,
      meaningClass: grammarPoints.meaningClass,
      meaningName: grammarPoints.meaningName,
      nameZh: grammarPoints.nameZh,
      glossZh: grammarPoints.glossZh,
    })
    .from(grammarPoints)
    .all();

  const points = new Map<string, GrammarPoint>();
  const byClass = new Map<string, GrammarPoint[]>();
  for (const row of rows) {
    const point: GrammarPoint = {
      ...row,
      difficulty: row.difficulty as GrammarDifficulty,
    };
    points.set(point.id, point);
    const peers = byClass.get(point.meaningClass);
    if (peers) peers.push(point);
    else byClass.set(point.meaningClass, [point]);
  }

  const patterns: GrammarPattern[] = db
    .select({
      pointId: grammarForms.pointId,
      units: grammarForms.units,
      left: grammarForms.left,
      right: grammarForms.right,
    })
    .from(grammarForms)
    .all()
    .map((form) => ({
      entryId: form.pointId,
      units: form.units.split('.'),
      left: form.left,
      right: form.right,
    }));

  const connections: ConnectionTable = {};
  for (const row of db.select().from(grammarConnections).all()) {
    connections[row.code] = row.rows.split(';').filter(Boolean);
  }

  const hash = createHash('sha256');
  for (const point of [...points.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(
      [point.id, point.difficulty, point.meaningClass, point.nameZh, point.glossZh].join('\t') +
        '\n',
    );
  }
  for (const form of patterns
    .map((p) => [p.entryId, p.units.join('.'), p.left, p.right].join('\t'))
    .sort()) {
    hash.update(form + '\n');
  }
  for (const code of Object.keys(connections).sort()) {
    hash.update(code + '\t' + connections[code]!.join(';') + '\n');
  }

  cached = {
    inventory: compileInventory({
      entries: [...points.values()],
      patterns,
      connections,
    }),
    point: (id) => points.get(id),
    peers: (id) => {
      const point = points.get(id);
      if (!point) return [];
      return (byClass.get(point.meaningClass) ?? []).filter((p) => p.id !== id);
    },
    size: points.size,
    stamp: hash.digest('hex').slice(0, 16),
  };
  return cached;
}

/** Drops the cache. For scripts that import つつじ and then read it back. */
export function forgetGrammar(): void {
  cached = null;
}
