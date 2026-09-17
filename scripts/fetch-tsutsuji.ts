/**
 * Delivers 「つつじ」 into `data/`, which is gitignored: regenerable, so fetched
 * rather than committed.
 *
 *   data/tsutsuji-1.1u.zip      the distribution, as published
 *   data/tsutsuji-source.json   where it came from and when
 *
 * つつじ (松吉俊・佐藤理史, CC BY-SA 4.0) is a dictionary of Japanese functional
 * expressions: 341 headwords, 435 meanings, 16,801 written forms, each with the
 * IPADIC connection constraints that say what may stand either side of it. That
 * last part is why it is here rather than a JLPT list -- the constraints are
 * written in the same tagset kuromoji emits, so grammar points can be found in
 * the token stream the reader already has.
 *
 * **The download is the weak link.** JMdict comes from a versioned release
 * feed; つつじ is published through a Google Drive link on a university page.
 * A rotted Drive link does not fail -- it answers 200 with an HTML page about
 * the missing file. So what arrives is opened as a ZIP and checked for the
 * members the import needs, and anything else is refused loudly. A grammar
 * feature that silently finds nothing is the failure this prevents.
 *
 * Run: npm run data:tsutsuji
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openZip } from '../src/lib/epub/zip.ts';

const DATA_DIR = 'data';
const ARCHIVE = join(DATA_DIR, 'tsutsuji-1.1u.zip');
const PROVENANCE = join(DATA_DIR, 'tsutsuji-source.json');

/** The published copy. `confirm=t` skips Drive's virus-scan interstitial. */
const DOWNLOAD =
  'https://drive.usercontent.google.com/download?id=1-Ya2uoUzGpQEtb9SMgq5OsC4vNZ9mkn_&export=download&confirm=t';

/** The page that publishes it, for the notice and for finding a new link. */
const HOME =
  'https://sites.google.com/edu.teu.ac.jp/cl-lab/研究/言語資源/日本語機能表現辞書つつじ';

/** What the import reads. A download without these is not つつじ. */
const REQUIRED = [
  'tsutsuji-1.1u/tsutsuji1.1.xml',
  'tsutsuji-1.1u/connectID',
  'tsutsuji-1.1u/className',
];

const force = process.argv.includes('--force');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses anything that is not the archive, and says what came instead.
 *
 * The interesting case is not corruption but substitution: Drive answering a
 * sign-in or quota page with status 200. Those are HTML, so the first bytes
 * tell them apart from a ZIP long before the central directory does.
 */
function verify(body: Buffer): string[] {
  const head = body.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new Error(
      `下載到的是一個 HTML 網頁，不是 ZIP 檔。\n` +
        `  Google Drive 的連結可能已失效或需要登入。\n` +
        `  請到 ${HOME} 取得新的下載連結，並更新 scripts/fetch-tsutsuji.ts。`,
    );
  }

  let names: string[];
  try {
    names = openZip(body).names;
  } catch (cause) {
    throw new Error(
      `下載到的檔案不是有效的 ZIP（${(cause as Error).message}）。\n` +
        `  請確認 ${HOME} 上的連結是否仍然有效。`,
    );
  }

  const missing = REQUIRED.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `ZIP 內容不是預期的つつじ 1.1u：缺少 ${missing.join('、')}。\n` +
        `  可能已改版。請檢查 ${HOME}，並更新 scripts/fetch-tsutsuji.ts 與 ` +
        `scripts/import-tsutsuji.ts 預期的檔名。`,
    );
  }

  return names;
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  if (!force && (await exists(ARCHIVE))) {
    const body = await readFile(ARCHIVE);
    verify(body);
    process.stdout.write(
      `つつじ 已在 ${ARCHIVE}（${(body.length / 1_000_000).toFixed(1)} MB）。` +
        `要重新下載請加 --force。\n`,
    );
    return;
  }

  process.stdout.write('下載つつじ…\n');
  const response = await fetch(DOWNLOAD);
  if (!response.ok) {
    throw new Error(
      `下載失敗：HTTP ${response.status} ${response.statusText}。\n` +
        `  請到 ${HOME} 確認連結。`,
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  const names = verify(body);

  await writeFile(ARCHIVE, body);
  await writeFile(
    PROVENANCE,
    `${JSON.stringify(
      {
        name: '日本語機能表現辞書「つつじ」 version 1.1u',
        authors: '松吉俊、佐藤理史',
        license: 'CC BY-SA 4.0',
        home: HOME,
        url: DOWNLOAD,
        bytes: body.length,
        members: names.length,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `  ${ARCHIVE}（${(body.length / 1_000_000).toFixed(1)} MB，${names.length} 個檔案）\n` +
      `  接著執行 npm run db:tsutsuji\n`,
  );
}

await main();
