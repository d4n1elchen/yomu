# Yomu — plan

What is decided and not yet built. Git history covers what happened; this
covers what is next and why. Delete sections as they ship.

## Naming

**Library** is the list of articles. **Dictionary** is vocabulary (and grammar
eventually). Never "lesson" — this is an article reader; "lesson-style" only
ever described the presentation.

Adding an article is its own page, not a dialog and not on the home screen.

## Interface language

**Traditional Chinese throughout** — navigation, controls, labels, and
explanations. The interface had drifted into three languages at once (English
nav, Japanese controls, Chinese explanations), each a reasonable local choice
that together read as unconsidered.

The only Japanese on screen is the material being studied: article text,
dictionary headwords, readings, inflected forms. That is the line — if it is
something you are learning, it stays Japanese; if it is the app talking to you,
it is Chinese.

## Dictionary data

JMdict is imported by two scripts into a gitignored `data/`: `npm run
data:jmdict` fetches, `npm run db:jmdict` imports and re-links. A fresh clone
has no dictionary until both have run, and the reader hides the difficulty
slider rather than marking every word.

**Two files, one source, and both are needed.** The XML pass is not redundant
with the simplified JSON, and neither signal it carries is sufficient alone:

- `nf01`–`nf48` (XML only) gives the *gradation* the slider moves along. 22,431
  entries carry one.
- `common` (the JSON's collapsed priority flag) is the *floor*. 7,726 entries
  JMdict marks common were never ranked by the newspaper corpus behind `nf` —
  本 carries `ichi1` and no band at all — so reading "no band" as "rarer than
  the 24,000th" put a dashed underline under the word for "book". This was
  found by building it; the phase plan had assumed no band meant hard.

**Not imported yet: `misc`.** JMdict's sense-level flags, worth a pass when
either of these starts to matter:

- `uk` ("usually written using kana alone") would fix headword choice.
  `headwordOf` takes the first common kanji, so it offers 積もり for つもり, 未だ
  for まだ and 迄 for まで. Only worth doing if `dict_entry.headword` is ever
  displayed — nothing shows it today, because Dictionary rows are headed by the
  spelling actually read.
- `poet`, `arch`, `obs`, `rare` would push dead vocabulary down the candidate
  list. いる currently trails 沃る and 率る, both marked poetical. This shortens
  the runners-up shown on an entry page; it changes no pick.

**Rejected, and still rejected.** BCCWJ: a balanced corpus and better data than
newspaper frequency, but UniDic lemmas would reintroduce the matching problem
lemma+reading measured away — revisit only if marking feels wrong for fiction.
**JMnedict: measured, and now rejected rather than deferred.** It was deferred
until we could count how many unmatched words in real reading are names. Counted:
**none of the 36 are.** Three carry IPADIC's 固有名詞 tag and not one is a name
(磨, `ToDo`, `ＫａｍｉＵ`). 13.4 MB to fix nothing.

### Homograph ambiguity — what is left of it

Grammar settles most of this. `lexeme.posDetail` and `conjugationType` carry
IPADIC's finer answer, and the matcher narrows candidates by mapped JMdict POS
before frequency gets a vote — 一段 against `v1`, 接尾 against `suf`. That fixed
この (was 九, "nine"), さん (was 三, "three") and いる (was 入る, "to enter").
They sit outside the lexeme identity key, so nothing re-files and no lexeme is
split by a POS that varies between sentences.

What remains is entries sharing lemma, reading **and** grammar. なる was the
whole of it when the corpus was one article — 生る "to bear fruit" at nf07 against
成る "to become" at nf34, both `v5r,vi`, both `uk`, both flagged common, with
nothing in JMdict to separate them and frequency pointing the wrong way. On real
chapters it is 73 words, so なる is the clearest example rather than the extent.

**Measured on 1,207 content words** (six articles, two of them real chapters —
the five-sentence denominator every earlier figure here used is gone):

| | | |
|---|---:|---:|
| matched on lemma+reading | 1,151 | 95.4% |
| …of those, ambiguous | 73 | 6.0% |
| matched on lemma only | 20 | 1.7% |
| unmatched | 36 | 3.0% |
| **matched overall** | **1,171** | **97.0%** |

Ambiguity is **6.0%**, not the ~15% that 5-of-34 implied — the small sample was
pessimistic. But the other half of that old note was optimistic: it guessed most
ambiguous cases would be entries with the same gloss and so not worth asking
about. **69 of the 73 went to the model**, meaning their glosses genuinely
differed. Asking is the common case, not the rare one.

The entry page prints the runners-up rather than a warning, so a wrong pick is
visible rather than apologised for. That stays regardless of what resolves the
ambiguity, because it is what makes a resolver's mistakes visible too.

The LLM resolver now settles this (`src/lib/dict/resolve.ts`), as background
work rather than at import — see “Analysis runs in the background” below, and note
that it is the pass which gates reading. It fires only on `lemma_reading_multi`
where the survivors' leading glosses actually differ, hands the model one occurrence sentence and the surviving entries, and
takes its pick only if the reply is one of the offered ids. The chosen link is
stamped with the model in `lexeme.dictResolver`, so it reads as resolved rather
than computed, is never asked twice, and a full JMdict relink clears the stamp
with the link it annotated. It selects, never names — the same grounding the
glosses follow. Whether it actually improves picks is unmeasured: なる is the one
wrong case on the current corpus, and one article is no way to know.

### What actually fails to match

The 36 unmatched content words, read one by one. Not one is a name, which is the
finding that retires JMnedict above.

- **15 are flattened ruby** — 濡 喚 忙 抜 溢 吐 摸 頷 芻 煌 摑 嘩 憐 擢 痺, every one a
  lone kanji the analyzer gave no reading. The source is text pasted from a page
  that renders furigana as `<ruby>`: copying flattens it, so `頷うなずいた` arrives
  with the reading sitting inline as ordinary characters. There is no `《》` or
  `｜` left to strip — the markup is gone by the time we see it. This is an
  **import problem, not a dictionary one**, and it is the single largest class.
- **4 are Latin or symbols** — `ＭＶ`, `Ⅴ`, `ToDo`, `ＫａｍｉＵ`. Not Japanese
  vocabulary and nothing should match them.
- **4 are verb forms JMdict spells differently** — 出せる, こなせる, 巻ける
  (potentials, which JMdict lists only in the plain form) and 差しかかる (which
  JMdict has as 差し掛かる).
- **3 are と-adverbs** — 黙々と, 整然と, 漠然と. JMdict carries 黙々 tagged
  `adv-to`; the と is ours to strip.
- **2 are ない-adjective stems** — ぴこち, 味気, where JMdict lists ぴこちない.
- **8 miscellaneous**, including real mis-analyses (羨い/トモイ).

Each of the last four groups is a small, mechanical rule against a known class,
not a fuzzy lookup fallback — which is why the fallback stays rejected while
these stay worth doing. None is urgent: together they are 13 words in 1,207.

### Flattened ruby corrupts an import

**EPUB import removes this at the source, for EPUBs.** `xhtmlToText` drops
`<rt>` and keeps the base text, so 頷 arrives as 頷 and the analyzer supplies the
reading it always did. The note below still stands for pasted text, which is
where the 15 flattened tokens in the corpus came from — and the cheap detection
rule is still unbuilt, because the cheaper fix turned out to be reading the file
instead of the rendered page.

Worth its own note because it is invisible and it is **not only a matching
problem**. `頷うなずいた` tokenizes as 頷 (unknown, no reading) + うなず + いた, so:

- the reader prints the reading as running text instead of as furigana above the
  kanji — you see 頷うなずいた on the page;
- the Dictionary gains a junk single-kanji entry, and the real word never appears;
- the vocabulary count is inflated by both halves.

Only 17 tokens of 4,915 here (0.3%), so it is small — but it scales with how much
of the library comes from ruby-bearing sources, and a whole novel pasted that way
would carry it on every annotated word. Detection is the hard part: `読` + `んだ`
is ordinary okurigana, and `頷` + `うなず` only differs in that the kana spell the
kanji's own reading — which needs a reading dictionary to know. The cheap version
is narrower and probably enough: **an unknown single-kanji token immediately
followed by hiragana is flattened ruby**, since IPADIC knows the kanji that appear
in ordinary okurigana compounds. Unbuilt, undecided.

### Rejected designs

Each of these was measured before it was rejected. The measurements are small —
one article — but they are what there is.

**JMdict as the analyzer's dictionary.** It has no inflected forms (it lists
眺める, never 眺め) and no costs at all, and cost is the entire mechanism that
resolves segmentation ambiguity. Building a MeCab dictionary from it means
recreating IPADIC without IPADIC's annotated corpus. The popup-dictionary
alternative — deinflect by rule, longest match wins — answers "what word is at
this cursor" and cannot produce a token stream, which the occurrence rows,
furigana alignment and selection offsets are all built on.

**A JMdict fallback for words matching nothing.** Still rejected, but the reason
has changed: it used to be "nothing to fix, 0 of 34 unmatched", and on real
chapters 36 of 1,207 (3.0%) are. Those 36 were then read, and a lookup fallback
would not have helped any of them — see the breakdown below. And the naive rule
was wrong 2 of 3 times on a
constructed test — 待っ+た rebuilds to 待った, which JMdict glosses "false start
of a bout", and い+た to いた, "board", at nf08 and so commoner than the right
answer. If revisited, the gate matters more than the lookup: only where
matching already failed, POS must agree, and no span may swallow a function
word. The real win class is narrow — compound verbs like 読み終わる that IPADIC
decomposes and JMdict lists whole, while keeping 読み返す together.

**Dropping `pos` from the lexeme identity key.** Tempting, because it looks
like it would stop one word splitting across parts of speech. It would not:
coarse POS varies only on function words — の is 名詞 and 助詞, ない is 形容詞
and 助動詞 — and merging those leaves the lexeme carrying whichever arrived
first. If の lands on 名詞, the commonest particle in the language walks past
`contentWord` into the vocabulary list and inflates every count. (勉強, which
seemed to motivate this, does not split: only the coarse POS is in the key and
it is 名詞 in both readings.)

**Keying `lexeme` on the matched JMdict entry.** It would merge 分かる, 判る and
解る everywhere for free, rather than only where a query remembers to group.
Rejected because it puts the least reliable link in the chain underneath the
data model: a bad match would pool two different words' occurrences instead of
mislabelling one page, and every improvement to matching would become a row
merge — with no principled answer for which `user_lexeme_state` survives it.
The Dictionary groups on `coalesce(dict_entry_id, lexeme.id)` at query time
instead.

## Where the mock is out of date

`design/*.dc.html` is committed and reads as current. Two places it is not,
each a deliberate departure rather than an omission:

- **Only marked words respond to a tap.** `Mobile.dc.html` has a 點選詞彙 tab
  implying any word is tappable. Tapping plain words was removed: an unmarked
  word is running text, with no cursor change and no focus stop, so nothing
  invites a tap that would open a card with nothing worth stopping for. This
  leaves touch devices reaching only marked words.
- **The difficulty slider runs 1–48, not 0–5.** That is the resolution the `nf`
  bands actually carry. 初級/進階 captions were added because 難易度 alone does
  not say which direction marks more words.

## Phase C — Chinese glosses — shipped

Both the glosses and the homograph resolver are built. What is worth keeping is
recorded where it stays true: the resolver's shape in the homograph subsection
above, and the translation contract in the `dict_sense` comment block. Two notes
that outlived the build:

- The structured-output path is `LlmRequest.format` (Ollama's `format` field),
  added deliberately because the interface had only `stream()` + temperature.
  Both passes use it with `temperature: 0`; both validate the reply (sense count
  for glosses, id-in-set for resolution), retry once, then leave the work undone.
- **One entry per request**, all its senses, rather than the 5–10-entry batch the
  plan first sketched: the per-entry count validation the plan also asks for is
  unambiguous only when the request is one entry, and correctness won over the
  round-trips. **Batching is now the one throughput lever left — see below.**

The card showing all senses with nothing auto-picked, and the deferred
per-occurrence `token.senseIndex`, both still hold — the analyzer's POS already
discards irrelevant senses and JMdict orders the rest by commonness.

## Analysis runs in the background

Measured on the first real chapter (a 94-sentence prologue, 483 lexemes): **459
entries to translate and 33 ambiguous lexemes to resolve.** One entry per
request, and `qwen3.8:27b` reports model family `qwen35`, which Ollama's
scheduler pins to `numParallel = 1` **regardless of `OLLAMA_NUM_PARALLEL`** — so
client-side concurrency buys nothing and the requests are serial by
construction. Blocking the import on that made a paste indistinguishable from a
hang.

So both passes moved out of the request into `ensureDraining`
(`src/lib/analysis/drain.ts`). Import returns as soon as the transaction commits
— 0.28s for a three-line article — and the action schedules the work with
`after()` from `next/server`, which still runs when the action ends in a
redirect.

**The two passes are not alike, and only one gates reading.** This is the whole
design:

- **Resolution moves `lexeme.dictEntryId`**, and that is what the Dictionary
  groups on, what `getDictionaryEntry` collects members by, and what the
  article's sense map is keyed on. An article read while it is running would
  file a word under one entry and then another. So a section is **not readable**
  until `section.resolvedAt` is stamped; the Library greys the row, prints
  progress, and refuses to link it, and the reader turns the URL away.
- **Translation only fills `glossZh`.** Nothing relocates, a card just gains
  Chinese. It gates nothing and runs for as long as it likes; an article is
  fully readable throughout, showing JMdict's English until the Chinese lands —
  the state the card was already built for. Gating nothing also means it has no
  natural place to appear, which is its own problem: a card showing English is
  indistinguishable from one that will always show English. The **Dictionary**
  carries the figure for that reason, under its summary line, saying outright
  that English stands in until the backlog clears. An entry counts as done only
  when none of its senses is still null, or the number would reach 100% while
  cards still showed English.

Resolution is also the cheap one: 33 requests against 459, about 7% of the work.
Gating on the small structural pass and letting the large cosmetic one run free
is what makes this cost nothing.

**Translation must never starve resolution — this was a real bug, not a
hypothetical.** The first cut resolved every pending section and only then
translated, holding the one-at-a-time flag for the entire backlog. Importing an
article while a previous one's glosses were still draining therefore queued the
new article's *resolution* behind hundreds of *translations* — the pass that
gates reading stuck behind the pass that gates nothing. Observed with 598 entries
queued: the new import sat greyed at 0%, indefinitely, while the drain worked on
glosses for an article already readable.

So the drain loops: resolve every pending section, translate **five** entries,
look again. Five is chosen against what the wait actually costs — a reader
staring at a greyed article — and bounds it to seconds instead of minutes. Any
scheme where translation runs to completion before resolution is rechecked
reintroduces this, however the queues are stored.

**Recovery is a page load.** Opening the Library calls `ensureDraining`, which
picks up every unresolved section and every untranslated entry, whatever import
left them behind — so a drain killed by a server restart resumes by itself.
Verified by stranding an article (importing through a script, which never fires
`after()`) and watching a single Library visit finish it. `npm run db:translate`
does the same on demand.

Three details that make it safe: a module-level flag keeps one drain in flight
(better-sqlite3 is a single synchronous connection, so there is no second worker
to coordinate with, and the writes are individually guarded anyway — but see the
starvation note above, because that flag is exactly what made the inversion
possible); a two-minute backoff stops a downed host being retried on every page
view; and both passes work at **whole-database scope**. That last one was also a
real bug in the first cut — scoped per-import, an entry left untranslated was
never revisited unless a later article happened to contain it too.

Both pages showing progress poll themselves while anything is pending
(`AnalysisPoller` calls `router.refresh()`, which re-runs the server component
because the pages are `force-dynamic`) and unmount it when the last item lands,
so an idle page costs nothing and every figure stays computed in exactly one
place. The poller skips a hidden tab: a backgrounded Library must not sit
refreshing against a local model host. Both pages fire `ensureDraining` too —
printing a figure that nothing is advancing would be worse than printing none.

### Rejected: a queue table

`glossZh is null` already is the translation queue, and `dictMatch =
'lemma_reading_multi' and dictResolver is null` is the resolver's. A job table
would be a second source of truth about work the data already describes, and it
would have to be reconciled with the rows on every JMdict re-import — which the
derived queues survive for free, because sense ids are `(entry, position)`.

What would justify revisiting: **repeated failures**. An entry the model mangles
twice is left null and retried from scratch on every drain, forever, with no
record. An attempt counter would fix that, and needs a queue-ish place to live.
Not built, because it has not been observed — measure before building.

### The drain gets out of the way

The drain and `/api/ask` share one Ollama host that serves one request at a time
and queues FIFO, so a grammar question asked mid-drain waited for the translation
in flight to finish. **Measured against 上がる** — 26 senses, a 9.0s entry — a
question's time to first token went from **0.4s to 9.4s**.

Waiting politely between entries does not fix this, and building it first was a
mistake worth recording: the drain awaits each entry, so it has a request
outstanding almost all the time, a question nearly always arrives mid-entry, and
FIFO already puts that question ahead of the drain's *next* request. The delay is
the **current** entry. Only dropping it gives the time back.

So `/api/ask` announces itself (`src/lib/analysis/priority.ts`) and the in-flight
background request is aborted. This is cheap only because the queues are derived:
an abandoned translation leaves `glossZh` null and an abandoned resolution leaves
`dictResolver` null — exactly the state before it started — so the next drain
picks them up and only the model time already spent is lost. **9.0s of added
latency became 0.4s.**

`abandoned` is kept distinct from `unreachable` throughout. They look identical
at a catch site, but one means retry at once and the other stops the drain for
two minutes; conflating them lets a single question idle the whole backlog.

### Rejected: batching entries per request

459 sequential requests per chapter looked like an argument for the 5–10
entries-per-request batch the first plan sketched, and it is the only throughput
lever left with server-side parallelism unavailable. Rejected on the contention
measurement above: batching makes the blocking unit 5–10× longer, so a question
arriving mid-batch waits for all of it. It trades round-trips for exactly the
latency that hurts. The wait is invisible anyway now that the drain is
background, so there was never much to buy — and per-entry count validation would
have had to move inside a batched reply to get it.

## 生詞 — picking words to learn

Built. The reader marks words statistically and you pick the real ones out of
them; the two are separate axes and that separation is the design.

**Underlining is never affected by user state.** `isHardWord` asks JMdict whether
a word is common and nothing else, so the dashed line means exactly one thing.
An earlier design had a "known" state suppress it, which was wrong in a way worth
recording: clearing the underline made the word plain text, plain text is not
tappable (see the mock departure above), and the action therefore had no undo
inside the reader. Marking now changes nothing about the word in the text, so the
toggle sits on the card you already opened and flips straight back.

The measurement that motivated it: **341 of 1,207** content words are marked at
the default level, and **162 of them stay marked at every slider setting** — they
have no frequency band and are not flagged common, so no slider position clears
them. The slider has a floor, and picking words by hand is what gets under it.

- **Presence is the state.** A row in `user_lexeme_state` means the word is on the
  list; removing it deletes the row. No flag to keep consistent with the row.
- **Keyed on `lexeme`, resolved on the Dictionary's group.** The JMdict link is
  the least reliable thing in the chain and must not sit underneath user state,
  so the key is the lexeme — which also means the 36 words that match nothing can
  still be kept, and those are exactly the words worth keeping. Reading resolves
  across `coalesce(dictEntryId, id)`, so 見る and 観る are one word here as they
  are one row there. **32 groups** hold more than one spelling. Adding writes
  against the spelling you met; removing clears the whole group, or the word
  would still read as marked through a spelling you never touched.
- **生詞 is a facet, not a page.** It joins the parts of speech in the Dictionary
  rather than introducing a third noun beside Library and Dictionary.

Still deferred: what to ask and when. `familiarity`, `lastReviewedAt` and
`srsDue` are created and unused, because a word on this list is precisely a word
a schedule would apply to — see Deferred below.

## EPUB import — built

A book is a `work` with many `section`s, which the schema always said. Nothing
in the schema, the analysis passes or the reader changed to accept one: the
importer parses an EPUB into the `IngestSection[]` that `ingestWork` already
took, and the note in `importPastedText` about splitting a novel happening at
the call site is now that call site.

**Chapters come from the table of contents, not from the files.** A spine
document is not a chapter — Kadokawa puts each chapter's 扉 image in its own
file and the prose in the next one, so splitting per file gave fourteen sections
for seven chapters, half of them empty. The walk goes down the spine in order,
starts a section at every document the contents links to, and accumulates the
ones it does not.

**Anything before the first chapter is dropped**, and the `cover` and `toc`
landmarks the book declares are dropped with it. Both of those pages carry text
once the markup is gone — the shop's boilerplate about thumbnails and vertical
layout, and the chapter titles over again — so emptiness caught neither, and
keeping them made a freshly imported book open on its cover. A file with no
contents at all keeps everything as one untitled section, because there is then
nothing to say where the body begins. 奥付 survives, because the contents lists
it after the body.

**No zip or XML dependency.** `zlib.inflateRawSync` does the only hard part and
the rest is a header format, so `zip.ts` reads the central directory itself and
`xhtml.ts` handles four constructs — ruby, breaks, block ends, entities. The
same trade the Markdown renderer made, for the same reason. Fixtures are built
in `fixture.ts` rather than committed, because the files this reads in anger are
copyrighted books.

**Ruby is dropped, and that is the point.** `<rt>` is thrown away and the base
text kept, so flattened furigana — the largest class of unmatched word in the
corpus, and a corruption of the Dictionary rather than only of matching — cannot
happen for a book. The reading goes because the analyzer owns readings; a second
source could only disagree.

Measured on the two sample books:

| | chapters | characters | tokens | sentences |
|---|---:|---:|---:|---:|
| 神椿市建設中。NOVELIZED | 8 | 136,779 | — | — |
| カミュの歌鳥 花譜小説集 | 16 | 116,554 | 71,188 | 4,429 |

Parsing is 23 ms, tokenizing a whole book 0.5 s, and the ingest transaction 6.4 s.
None of that is the cost. **The drain is**: one book added 353 resolutions and
several thousand entries to translate, against a host that serves one request at
a time.

### A book made the Library's readability gate wrong

The Library used to grey a work until **every** section resolved, on the
reasoning that a book becomes readable when all its chapters have settled. With
a real sixteen-chapter book that meant hundreds of model requests between
importing a novel and reading any of it, while chapter one had been ready for
minutes.

So `ArticleSummary` now carries `readable` separately from `analysis`: the row
links as soon as the chapter it would open can be opened, and keeps printing
progress while the rest of the book resolves. The invariant is untouched and was
never the work-level one — a *section* is readable when its own `resolvedAt` is
stamped, which is what `isReadable` enforces and what the reader turns a URL away
on. Gating the whole work was a display choice, and it only looked right while a
work was one section.

The entry section is now the first **readable** chapter rather than the first
chapter, or a click would land on a page the reader bounces.

### Chapter navigation

The Library links to one section per work, so without a list carried into the
reader chapter seven is unreachable. `getArticle` returns every section of the
work; the reader draws a collapsed 目次 above the prose and the neighbours below
it, and draws neither when there is only one section. A chapter still resolving
is printed but not linked — the same reason the Library greys a row.

### Not built

- **A chapter picker.** Importing is all-or-nothing, and a sixteen-chapter book
  is a large commitment to a serial drain. The parser already reports each
  chapter's length for exactly this, and nothing uses it yet.
- **Appending to an existing work.** Every import creates a new work, so a novel
  pasted chapter by chapter is still six unrelated Library rows.
- **`section.parentId`.** Written as null, never read. A nested contents is
  flattened: entries pointing into a file already claimed are ignored, so
  subsections do not split their chapter.
- **The reading in `<rt>`.** Thrown away. If the analyzer's furigana is ever
  checked against the book's own, that is where the book's answer was.

## Installable on a phone — built

A manifest, three icons and the Apple meta tags. The icon is 読 in mincho on the
accent brown, drawn at half the canvas so it survives a circular mask as well as
a square one; the same 512 file is declared for both purposes rather than
resized twice.

**A service worker was rejected here and then built — see below.** The reasoning
that rejected it was right about the danger and wrong about the remedy: caching
pages rendered from the database would indeed have produced a reader that looks
live and is not. Storing *data* rather than *pages* avoids that, which is what
shipped.

`start_url` is `/library` rather than `/`, because `/` only redirects there and a
launch should not pay for the round trip.

## Offline reading — built

Downloaded chapters, held in IndexedDB, rendered by the reader that already
exists. The whole feature rests on one property the app happened to have: the
reader is a client component handed a self-contained `Article` — sentences,
tokens, readings, every sense for every word, the 生詞 keys — so a download is a
copy from memory to disk and needs no request at all.

**Data in IndexedDB, shell in the Cache API, and never the two mixed.** The
service worker caches only `/offline` and the hashed build assets. It caches no
page rendered from the database, because such a copy is a snapshot that drifts
from the server without ever saying so. When a navigation fails it redirects to
`/offline`, which is honest about being a shelf of what you saved rather than a
stale version of what you asked for. A redeploy replaces the shell wholesale and
leaves the downloads untouched, which is exactly why they are stored apart.

`/offline` is the only statically rendered page in the app, which is what makes
it cacheable. It reads `?s=` from `location` rather than `useSearchParams`,
because the latter would opt the route into dynamic rendering and leave nothing
to cache.

**The bug worth remembering: `fetch` decodes a body but keeps the headers that
described the encoded one.** Stored verbatim, the cached `/offline` carried
`Content-Encoding: gzip` over plain HTML, and every offline navigation failed
with a decoding error that looks exactly like having nothing cached. `storable()`
strips that, `Content-Length`, and the hop-by-hop `Transfer-Encoding`. Verified
by stopping the server process outright: the shelf loads, a chapter opens, and a
word card shows its Chinese gloss with nothing listening on the port.

**Still online-only, by nature.** Grammar questions need the model. Marking a
word offline holds for the session and is lost on reload — the action is
swallowed rather than queued, because a replay queue has not been missed yet.
Measure before building one.

**Requires a secure context**, so it does nothing over plain HTTP on a LAN
address. Development registers no worker either, and actively unregisters one
left behind by a production build on the same origin.

## Reading position — built

The Library already reopened a book at the chapter you last read; this adds
where in that chapter. `section.progressSentenceId` holds the sentence you had
reached, and the reader scrolls back to it on open.

**A sentence id, not a scroll offset or a percentage.** An offset moves with the
window width, the font and the furigana; an index moves when an edit splits an
earlier sentence. The id goes stale only if that sentence itself is merged away,
and then the reader starts at the top. **On the server, not in `localStorage`**,
because the point is putting a book down on the laptop and picking it up on the
phone.

**"Where you are" is the last sentence to have started above the reading line**
(just under the header), not the first one still on screen. Sentences are
inline, so one often ends on the line where the next begins. Resuming puts a
sentence's first line on the reading line, and the "still on screen" rule then
picked the sentence ending on that line, so every open moved the bookmark back
one line. Checking where sentences start gives back the sentence you resumed at.
Checked in the browser: a 454-sentence chapter resumed at the saved sentence,
and a small scroll there sent no save.

**Only scrolling saves.** Scrolls in the first 800 ms are ignored: the resume
itself, a jump to a `#sentence-` anchor, the browser restoring a reload's
offset. A Dictionary occurrence link wins over the saved position and does not
overwrite it. Saves happen after a second of stillness and again with
`keepalive` when the page is hidden. It is kept apart from `lastReadAt`, which
waits ten visible seconds so background tabs cannot reorder the Library. A
background tab cannot scroll, so this needs no such wait.

**Offline copies keep their own position**, in the small summary record rather
than in the megabyte article, and every save writes both places when the chapter
is downloaded. The two can drift apart: a position recorded offline never reaches
the server. This is the same trade as a 生詞 mark made offline, left unsynced for
the same reason. Unverified in a browser, because development registers no
service worker.

**Not shown in the Library.** A percentage per row was left out because nobody
asked for it. Adding one needs only the saved sentence's order within its
section.

## Deleting an article — built

A work goes, and its sections, sentences and tokens go with it by the cascades
already on those tables. **Lexemes do not**, which is the whole of the design:
the schema is explicit that orphans are never collected, because a lexeme is a
word you have met and possibly marked as 生詞, and deleting an article must not
quietly unlearn it.

The visible consequence, and it is worth knowing rather than hiding: a word met
only in the deleted article keeps its row and its 生詞 mark but drops out of the
Dictionary's listings, which count occurrences by joining tokens. It comes back
whole the moment the word appears in something else.

**Confirmed in place, not in a dialog.** Two taps, because nothing here is
undoable and there is no trash. A dialog would be conventional and would also be
the only one in the app, which would make deletion its most ceremonious action.
The primed state disarms after five seconds so a stray tap on a phone does not
leave a live delete button under your thumb. A book's confirmation names the
chapter count, since one row stands for sixteen chapters.

**The device that deletes also forgets its downloads.** The server cannot reach
IndexedDB, so the click that confirms the deletion is the one moment anything
knows both that the work is gone and which downloads belonged to it --
`deleteWorkChapters` runs there, right after the action returns. Failure is
swallowed: the article is already deleted and a leftover download still reads.

**Still open: another device keeps its copy.** Making a phone notice that a
laptop deleted something needs an endpoint listing live section ids and a
reconcile pass on the shelf. Not built, because it only bites if you download and
delete on different devices, and a stale download is untidy rather than broken.
Revisit when that actually happens.

## Deferred

**Grammar.** The earlier design — entries created during Q&A, with the agent
deciding novelty — was wrong and has been removed. Vocabulary dedups on a
natural key the analyzer derives mechanically; a model inventing names for
grammar points produces near-duplicates that only become visible once the
collection is large enough to matter.

Grammar needs a natural key first. Two candidates:

- **Token-stream patterns**, matched deterministically as you read. This is the
  genuinely vocab-like answer and would make grammar points appear while
  reading rather than requiring you to ask. Costs authoring the patterns, and
  nuance-based points do not reduce to patterns.
- **A fixed inventory the model may only select from**, never name. Cheaper,
  keeps the key stable, but ties grammar to asking and cannot record anything
  outside the list.

Undecided deliberately, until there is real reading to ground the choice in.

**Also deferred:** JMnedict, URL import, transcription. File import is built for
EPUB — see above — and for nothing else.

## Open questions

- Which Ollama model beyond `qwen3.8:27b`.
- Whether the reader must work when the model host is unreachable. **Half
  answered:** translation says no — an article reads fine with English glosses
  and fills in later. Resolution says yes, and gates reading, so a **new** article
  imported while Ollama is down stays greyed until the host returns. It is
  recoverable rather than lost (any Library visit resumes it) and articles
  already resolved are unaffected, but if that proves annoying the fallback is to
  stamp `resolvedAt` anyway and accept the deterministic picks — which is simply
  what shipped before Phase C. Deliberately not done, because it would discard
  the model's input permanently rather than deferring it.
- Transcriber choice — prefer one emitting per-segment confidence and timings,
  since `sentence.confidence`, `startMs` and `endMs` already exist for it.
