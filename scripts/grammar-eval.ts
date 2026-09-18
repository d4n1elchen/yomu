/**
 * Scores grammar identification against the hand-labelled spans.
 *
 * Run: node scripts/grammar-eval.ts [--matcher-only]
 *
 * `data/grammar-labels.json` holds 200 candidate spans from the local library,
 * each labelled by hand with the point it is, or NONE (not a grammar use here),
 * or OTHER (grammar, but the right point was not among the candidates offered).
 * Gitignored, because the sentences are copyrighted book text.
 *
 * Two numbers matter and they are not the same:
 *
 *   coverage   how often the matcher offers the right point at all. Nothing
 *              downstream can recover from this being wrong.
 *   precision  how much of what the model then accepts is correct -- a wrong
 *              card is one a reader might file, so this is what a card costs.
 *
 * The labels were made against a scratch matcher, so a span here can fail to
 * reappear: the shipped matcher drops a short span that overlaps a longer one,
 * on purpose. Those are reported as `swallowed` rather than counted as misses,
 * with the longer span that replaced them -- which is the fix working, not a
 * regression, and the distinction has to be visible or the score means nothing.
 */

import './env.ts';
import { readFile } from 'node:fs/promises';
import { getAnalyzer } from '../src/lib/analyzer/index.ts';
import { loadGrammar } from '../src/lib/grammar/load.ts';
import { matchSentence } from '../src/lib/grammar/match.ts';
import { identifyGrammar } from '../src/lib/grammar/identify.ts';
import { sqlite } from '../src/db/client.ts';

const LABELS = 'data/grammar-labels.json';

interface Label {
  id: number;
  sentence: string;
  surface: string;
  charStart: number;
  charEnd: number;
  morphemes: number;
  candidates: string[];
  gold: string;
}

const matcherOnly = process.argv.includes('--matcher-only');

function pct(n: number, of: number): string {
  return of === 0 ? '—' : `${Math.round((100 * n) / of)}%`;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(LABELS, 'utf8');
  } catch {
    throw new Error(`找不到 ${LABELS}。`);
  }
  const labels: Label[] = JSON.parse(raw).spans;

  const grammar = loadGrammar();
  if (grammar.size === 0) {
    throw new Error('文法庫是空的。請先執行 npm run data:tsutsuji 與 db:tsutsuji。');
  }

  const analyzer = getAnalyzer();
  const stats = {
    offered: 0,
    swallowed: 0,
    absent: 0,
    accepted: 0,
    correct: 0,
    falseAccept: 0,
    wrongMeaning: 0,
    rejected: 0,
    rightlyRejected: 0,
    real: 0,
  };
  const notes: string[] = [];

  for (const label of labels) {
    const tokens = await analyzer.analyze(label.sentence);
    const matches = matchSentence(tokens, grammar.inventory);
    const here = matches.find(
      (m) => m.charStart === label.charStart && m.charEnd === label.charEnd,
    );
    const real = label.gold !== 'NONE' && label.gold !== 'OTHER';
    if (real) stats.real++;

    if (!here) {
      const covering = matches.find(
        (m) => m.charStart <= label.charStart && label.charEnd <= m.charEnd,
      );
      if (covering) {
        stats.swallowed++;
        if (notes.length < 12) {
          notes.push(
            `  swallowed  ${label.surface} → ${covering.surface} ` +
              `(${covering.entryIds.map((id) => grammar.point(id)?.base ?? id).join('／')})`,
          );
        }
      } else {
        stats.absent++;
        if (notes.length < 12) notes.push(`  gone       ${label.surface}｜${label.sentence.slice(0, 40)}`);
      }
      continue;
    }

    const offeredRight = real && here.entryIds.includes(label.gold);
    if (offeredRight) stats.offered++;

    if (matcherOnly) continue;

    // A run is 200 requests, and the model host sits behind a LAN name that has
    // failed to resolve mid-run more than once. One failed request must not
    // throw away the other 199, so each gets a few attempts.
    let picked: Awaited<ReturnType<typeof identifyGrammar>> | null = null;
    for (let attempt = 0; attempt < 4 && picked === null; attempt++) {
      try {
        // The whole sentence, as the card asks it -- not the one span. Judging
        // a span beside its neighbours is what lifted recall from 79% to 91% in
        // the measurement, so scoring one span at a time measures a request the
        // app never makes, and under-reports it.
        picked = await identifyGrammar({
          sentence: label.sentence,
          matches,
          grammar,
        });
      } catch (cause) {
        if (attempt === 3) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
      }
    }
    if (!picked) continue;
    // The card for this span, if one was offered. A point the card files once
    // per sentence may have been kept at an earlier span of the same point, so
    // a same-point card elsewhere in the sentence counts as this one.
    const card =
      picked.points.find(
        (p) => p.charStart === label.charStart && p.charEnd === label.charEnd,
      ) ?? picked.points.find((p) => here.entryIds.includes(p.pointId));
    const choice = card?.pointId ?? null;

    if (choice === null) {
      stats.rejected++;
      if (!real) stats.rightlyRejected++;
    } else {
      stats.accepted++;
      if (choice === label.gold) stats.correct++;
      else if (real) stats.wrongMeaning++;
      else stats.falseAccept++;
    }
  }

  const seen = labels.length - stats.swallowed - stats.absent;
  process.stdout.write(
    `\n${labels.length} 個標註：${seen} 個仍然命中、` +
      `${stats.swallowed} 個被更長的片語吸收、${stats.absent} 個消失\n` +
      `候選涵蓋率 ${stats.offered}/${stats.real}（${pct(stats.offered, stats.real)}）` +
      ` — 正確句型有出現在候選中\n`,
  );

  if (!matcherOnly) {
    process.stdout.write(
      `模型接受 ${stats.accepted} 個，其中正確 ${stats.correct}（精確率 ${pct(
        stats.correct,
        stats.accepted,
      )}）\n` +
        `  誤收：非文法 ${stats.falseAccept}、選錯意義 ${stats.wrongMeaning}\n` +
        `模型拒絕 ${stats.rejected} 個，其中本來就該拒絕 ${stats.rightlyRejected}\n` +
        `涵蓋率內的召回率 ${pct(stats.correct, stats.real)}\n`,
    );
  }

  if (notes.length > 0) process.stdout.write(`\n${notes.join('\n')}\n`);
  sqlite.close();
}

await main();
