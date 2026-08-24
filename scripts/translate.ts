/**
 * Drains the analysis backlog: homograph resolution for every section still
 * waiting, then Chinese glosses for every entry the vocabulary points at.
 *
 * Run: npm run db:translate
 *
 * The same work the app does in the background, on demand. Useful after a
 * JMdict re-import (which relinks every lexeme and clears the resolver stamps),
 * after a long stretch with the model host down, or simply to finish a backlog
 * without leaving the Library open.
 */

import { ensureDraining } from '../src/lib/analysis/drain.ts';
import { sqlite } from '../src/db/client.ts';
import { pendingTranslationCount } from '../src/lib/translate/translate.ts';

async function main(): Promise<void> {
  const started = Date.now();
  const before = pendingTranslationCount();
  process.stdout.write(`${before} entries await translation\n`);

  await ensureDraining();

  const after = pendingTranslationCount();
  process.stdout.write(
    `translated ${before - after}, ${after} still pending, ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
  if (after > 0) {
    process.stdout.write(
      'Some remain: either the model host was unreachable, or it returned a ' +
        'reply that failed validation twice. Re-run to retry them.\n',
    );
  }
  sqlite.close();
}

await main();
