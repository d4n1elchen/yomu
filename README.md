# Yomu — 読む

An LLM-assisted Japanese reader. You read the Japanese; the app explains it.

Paste an article or import an EPUB, and Yomu segments it, puts furigana over
the kanji, underlines the words a newspaper corpus says are uncommon, and
answers questions about any sentence you select. Word definitions are
Traditional Chinese, translated from JMdict rather than invented.

The interface is Traditional Chinese throughout. The only Japanese on screen is
the material being studied — article text, dictionary headwords, readings, and
inflected forms.

Marking and learning are separate axes, deliberately. A difficulty slider moves
the underlines along JMdict's frequency bands, and that is statistical only —
nothing you do changes it. On top of it you pick the words you actually mean to
learn (生詞), from the same card you already opened. Picking a word leaves it
underlined, which is what keeps the action reversible: an unmarked word is
running text and cannot be tapped again.

## The division of labour

This is the one idea the rest of the design follows from.

**The analyzer owns segmentation, readings and dictionary forms.** kuromoji with
IPADIC splits the text, and every reading you see comes from it.

**The model owns grammar and nuance, and is never asked for a reading.** Every
model tested invents them — one rendered 窓の外 as まどのはら. The Q&A prompt
hands the model the analyzer's segmentation and readings as fact and instructs
it not to produce its own.

The model does exactly two other things, and only one of them gates reading:

- **Homograph resolution** picks between dictionary entries that nothing in the
  data can separate — 成る "to become" against 生る "to bear fruit", identical in
  lemma, reading and grammar, with frequency pointing at the wrong one. This
  moves which entry a word is filed under, so a chapter is not readable until it
  finishes. It is about 7% of the model work.
- **Gloss translation** writes the Chinese on a word card. It moves nothing, so
  it gates nothing: an article reads fine with JMdict's English until the
  Chinese lands.

Both run as a background drain that resumes by itself. A grammar question
abandons whatever the drain has in flight, because the model host serves one
request at a time.

## Requirements

- **Node 22 or newer.** TypeScript runs in strip-only mode, with no build step
  for scripts.
- **[Ollama](https://ollama.com)** reachable over HTTP, with `qwen3.8:27b`
  pulled. Smaller models are not viable: a 9B mangled 座る into "座っ (zutta)"
  and missed the sentence's main grammar point entirely.
- Nothing else. SQLite is bundled, and there is no separate database server.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in YOMU_OLLAMA_URL
npm run db:migrate
npm run data:jmdict          # downloads JMdict, ~118 MB
npm run db:jmdict            # imports it and links existing words
npm run dev
```

The two JMdict steps are separate from the rest because the data is gitignored
and regenerable. Skip them and the reader still works, but it hides the
difficulty slider rather than marking every word as hard.

`.env.local` **must be UTF-8.** Next parses env files as UTF-8, and a UTF-16 one
— which is what PowerShell's `>` and `Set-Content` write by default — is ignored
without a word while looking perfectly correct in an editor.

To read on a phone on the same network, put that machine's LAN address in
`YOMU_DEV_ORIGIN`. Without it Next returns 403 for its own client chunks, the
page renders and never hydrates, and it looks exactly like broken React.

## Importing

**Paste** any Japanese text on the 新增文章 page. One article, one section.

**An EPUB** becomes a book: one Library row with its chapters behind it, split
at the book's own table of contents rather than per file. Front matter is
dropped on the cover and contents landmarks the file declares.

Importing an EPUB is also the only way to get furigana right in books that have
it. Copying from a rendered page flattens ruby — `頷うなずいた` — which
tokenizes into three junk pieces, prints the reading as running text, and adds a
single-kanji entry to the Dictionary. Reading the markup keeps the base text and
drops `<rt>`, so it never happens.

Tokenizing a whole novel takes about half a second; the import transaction takes
seconds. What takes hours is the model drain behind it, which is why reading is
gated per chapter rather than per book.

## Deployment

Self-hosted on one machine. The database is a local file and the analyzer reads
its dictionary off disk, so the app and its data live together and there is
nothing to push.

```bash
npm run deploy    # install a systemd user service and restart it
npm run update    # fetch, fast-forward, redeploy
```

`scripts/deploy.sh --print-unit` shows the unit file it would write.
`npm run update -- --check` reports what would be pulled without touching
anything.

Where the service listens is set in `.env.local`, alongside `YOMU_OLLAMA_URL`:

```ini
YOMU_HOST=0.0.0.0   # 127.0.0.1 to keep it off the network
YOMU_PORT=3000
YOMU_SERVICE=yomu   # the systemd unit's name
```

The app never reads those three. They become `-H`, `-p` and the unit's filename
when the unit is generated. Setting them on the command line works for a one-off
and is deliberately not persistent: the unit is rewritten from scratch on every
deploy, so a port passed that way reverts on the next plain `npm run deploy`.

## On a phone

The app is installable to a home screen: it ships a manifest and icons, opens
in a standalone window with no browser chrome, and takes the paper ground as its
theme colour so the status bar and the page are one surface.

**Chapters can be downloaded to read offline.** The button is in the reader, and
what it saves goes to IndexedDB — sentences, readings, every sense for every
word, so the word cards and the difficulty slider work with no network at all.
Downloaded chapters appear under 離線書櫃, and a service worker serves that page
when the server cannot be reached.

Two things stay online-only, by nature rather than by omission. Grammar questions
need the model. And nothing else is cached: every other page is `force-dynamic`
and rendered from the database, so a cached copy would be a snapshot that drifts
without saying so. Going offline anywhere in the app lands you on the shelf of
what you actually saved.

All of this needs a secure context. Over plain HTTP on a LAN address the worker
will not register and downloads are unavailable; serve the app over HTTPS, or
reach it on `localhost`, and it works.

## Scripts

| | |
|---|---|
| `npm run dev` | development server |
| `npm test` | `node:test`, colocated as `*.test.ts` |
| `npm run build` / `start` | production build and server |
| `npm run db:migrate` | apply Drizzle migrations |
| `npm run db:generate` | generate one from a schema change |
| `npm run data:jmdict` | download JMdict into `data/` |
| `npm run db:jmdict` | import it and re-link every word |
| `npm run db:translate` | drain the gloss queue on demand |
| `npm run deploy` / `update` | see above |

## Layout

| | |
|---|---|
| `src/app` | routes: Library, Dictionary, reader, import, `/api/ask` |
| `src/lib/analyzer` | kuromoji, and the only source of readings |
| `src/lib/dict` | JMdict matching and homograph resolution |
| `src/lib/epub` | ZIP, XHTML and EPUB readers, no dependencies |
| `src/lib/analysis` | the background drain and its priority rules |
| `src/db` | Drizzle schema — read the comments before extending it |
| `docs/PLAN.md` | what is decided and not yet built, and what was rejected |

There is no Markdown library, no zip or XML library, and no CSS framework. Each
absence is deliberate and explained where the replacement lives.

## Data and licence

Definitions come from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html),
© Electronic Dictionary Research and Development Group, used under
[CC BY-SA](https://www.edrdg.org/edrdg/licence.html). The attribution is a
condition of the licence rather than a courtesy, and the app carries it on both
Dictionary pages.

Imported books stay on your machine. Nothing is uploaded, and the model runs on
a host you point the app at.
