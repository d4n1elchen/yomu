/**
 * Writes the Traditional Chinese name and gloss on every grammar point that
 * lacks one.
 *
 * Run: npm run db:grammar-gloss   (after npm run db:tsutsuji)
 *
 * About 435 points on a fresh import, eight to a request. Re-running picks up
 * whatever is still missing, so an unreachable model host costs a re-run rather
 * than a restart. What it writes is a draft: it is reviewed by hand before a
 * reader sees it, and `grammar_point.gloss_model` records where it came from.
 */

import './env.ts';
import { sqlite } from '../src/db/client.ts';
import { glossGrammarPoints, pendingGlossCount } from '../src/lib/grammar/gloss.ts';

async function main(): Promise<void> {
  const before = pendingGlossCount();
  if (before === 0) {
    process.stdout.write('每個句型都已經有中文名稱了。\n');
    sqlite.close();
    return;
  }

  process.stdout.write(`${before} 個句型還沒有中文名稱。\n`);
  const started = Date.now();

  const progress = await glossGrammarPoints({
    onBatch: (p) =>
      process.stdout.write(
        `  ${p.glossed}/${before}（${((Date.now() - started) / 1000).toFixed(0)}s）\n`,
      ),
  });

  const remaining = pendingGlossCount();
  process.stdout.write(
    `完成 ${progress.glossed} 個，剩下 ${remaining} 個，` +
      `耗時 ${((Date.now() - started) / 1000).toFixed(1)}s。\n`,
  );
  if (remaining > 0) {
    process.stdout.write('再執行一次可以接著補完剩下的。\n');
  }
  sqlite.close();
}

await main();
