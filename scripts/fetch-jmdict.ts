/**
 * Delivers JMdict into `data/`, which is gitignored -- both files are large and
 * regenerable, so they are fetched rather than committed.
 *
 * Two files, one source:
 *
 *   data/jmdict-eng.json   jmdict-simplified. Structure and English glosses.
 *   data/JMdict_e.xml      the original from EDRDG. Frequency rank only.
 *
 * The second is not redundant. jmdict-simplified collapses JMdict's nf01-nf48
 * frequency bands into a single boolean `common`, and roughly 95% of real
 * reading vocabulary is flagged common -- a flag that says "yes" to almost
 * everything cannot drive a difficulty slider. The bands survive only in the
 * XML's <ke_pri>/<re_pri>. Both files key on the same JMdict entry id, so the
 * two are joined with no matching work at all.
 *
 * Run: npm run data:jmdict
 */

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const DATA_DIR = 'data';
const SIMPLIFIED = join(DATA_DIR, 'jmdict-eng.json');
const XML = join(DATA_DIR, 'JMdict_e.xml');
const PROVENANCE = join(DATA_DIR, 'jmdict-source.json');

const RELEASES =
  'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const EDRDG_XML = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';

const force = process.argv.includes('--force');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function download(url: string, label: string): Promise<Buffer> {
  process.stdout.write(`  fetching ${label}…\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  process.stdout.write(`  got ${mb(body.length)} compressed\n`);
  return body;
}

/**
 * Reads the single JSON member out of a tar archive.
 *
 * A whole tar library would be the obvious move, but the archive holds exactly
 * one file and the format is 512-byte headers with the size in octal at offset
 * 124 -- less code here than a dependency plus its supply chain.
 */
function untarOne(tar: Buffer, suffix: string): Buffer {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/u, '');
    // Two consecutive zero blocks end the archive; an empty name is one of them.
    if (name === '') break;
    const size = parseInt(
      tar.toString('utf8', offset + 124, offset + 136).replace(/[\0 ]/gu, ''),
      8,
    );
    const start = offset + 512;
    if (name.endsWith(suffix)) return tar.subarray(start, start + size);
    // Entries are padded up to a 512-byte boundary.
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`no ${suffix} member in archive`);
}

/** Writes via a temp name so an interrupted run cannot leave a half file. */
async function place(path: string, body: Buffer): Promise<void> {
  const temp = `${path}.partial`;
  await writeFile(temp, body);
  await rename(temp, path);
  process.stdout.write(`  wrote ${path} (${mb(body.length)})\n`);
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  const have = (await exists(SIMPLIFIED)) && (await exists(XML));
  if (have && !force) {
    process.stdout.write(
      `${SIMPLIFIED} and ${XML} are already here. Pass --force to refetch.\n`,
    );
    return;
  }

  process.stdout.write('jmdict-simplified (structure and English glosses)\n');
  const releaseResponse = await fetch(RELEASES, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!releaseResponse.ok) {
    throw new Error(`release lookup: HTTP ${releaseResponse.status}`);
  }
  const release = (await releaseResponse.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };

  // The English-only build, not `-common`: the common subset drops exactly the
  // rare words a difficulty slider exists to mark.
  const asset = release.assets.find(
    (a) => /^jmdict-eng-[^-]+\.json\.tgz$/u.test(a.name),
  );
  if (!asset) {
    throw new Error(
      `no jmdict-eng .json.tgz in release ${release.tag_name}; assets were ` +
        release.assets.map((a) => a.name).join(', '),
    );
  }

  const tgz = await download(asset.browser_download_url, asset.name);
  await place(SIMPLIFIED, untarOne(gunzipSync(tgz), '.json'));

  process.stdout.write('\nJMdict XML (frequency bands)\n');
  const gz = await download(EDRDG_XML, 'JMdict_e.gz');
  await place(XML, gunzipSync(gz));

  await writeFile(
    PROVENANCE,
    `${JSON.stringify(
      {
        simplifiedRelease: release.tag_name,
        simplifiedAsset: asset.name,
        xmlSource: EDRDG_XML,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    '\nJMdict is made available by the Electronic Dictionary Research and\n' +
      'Development Group under a Creative Commons Attribution-ShareAlike\n' +
      'licence. See https://www.edrdg.org/edrdg/licence.html\n' +
      '\nNext: npm run db:jmdict\n',
  );
}

await main();
