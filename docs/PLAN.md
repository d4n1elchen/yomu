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
**JMnedict: still rejected, for a different reason.** On the first article none of
the 36 unmatched words was a name. On a novel, names are the largest class by
far — 遥 275 times, チハル 40, 三枝 30 — but they are the book's own characters,
and 千遥 is split by the analyzer before any lookup could see it. JMnedict knows
neither. Names are confirmed per work from the reader instead — see “Book ruby
and names” below.

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
where the survivors' leading glosses actually differ, hands the model up to three occurrence sentences and the surviving entries, and
takes its pick only if the reply is one of the offered ids. The chosen link is
stamped with the model in `lexeme.dictResolver`, so it reads as resolved rather
than computed, is never asked twice, and a full JMdict relink clears the stamp
with the link it annotated. It selects, never names — the same grounding the
glosses follow.

**Measured by reading its 214 picks on the local library: clearly wrong on at
least a dozen, and the worst on the commonest words.** の (名詞・非自立, 570
tokens) → 野 "field"; しれる in かもしれない (72) → 痴れる "to become foolish";
様態 そう (41) → 壮 "bravery"; ゆく → 逝く "to die"; 〜かける → 欠ける; the ordinal
め → 奴 "bastard"; よろしく → 夜露死苦. Two causes, fixed separately:

- **The right entry was not a candidate.** The POS map offered 非自立 nouns only
  noun entries, so the nominalizer の never met JMdict's particle の; 接尾 missed
  the auxiliary そう; and when nothing agreed the fallback took every entry, so
  a verb (〜てく's く) could land on 句. Fixed in `pos.ts`: 非自立 admits `prt`,
  接尾 admits `aux`, function words admit `exp`, and the fallback stays within
  the word's family — a verb never falls back to a noun, and 助動詞, 助詞,
  接頭詞 and 感動詞 have the same floor, so the classical り and つ (absent from
  JMdict) stay unmatched rather than taking 離 and 箇.
- **It chose on too little.** One leading gloss per entry (目 shows "eye", not
  its suffix sense "-th") and one sentence per lexeme. It is now shown the
  senses whose POS fits, up to three, marked 常用/少用, and three distinct
  sentences from across the library.

**Measured on the served library: it fixes them.** `npm run db:relink`
re-matches everything and re-asks the model about every ambiguous lexeme,
printing each link it moves — which is how this was read. の → の (particle),
そう → そう, こと → 事, もの → 物, よう → 様, わけ → 訳, せい → 所為, なる → 成る,
め → 目, ゆく → 行く, たび → 度, いくら → 幾ら, あたり → 辺り, いつか → 何時か.
**Still wrong: 〜かける takes 欠ける** where it means 掛ける. About 200 requests,
roughly 20 s each against a host that also serves the app.

**Rejected after trying it: letting the model answer “none”.** It was added for
the case the candidate list does not hold the word at all. Given the option, the
model used it to second-guess segmentation instead: on the first full run it
unlinked しれる (66 occurrences), いう (47), はず (40), もつ, あげる and きれる —
every one a word used as a helper, where it judged the entry was not what the
sentence meant. An unlinked word loses its glosses and is marked hard, so that
trade is bad even where the judgement is defensible. Telling it in the prompt
that a helper use still takes its own entry did **not** stop it: a second run
rejected 30 again. The option is gone, and what it was for is handled before the
model sees anything, by the family floor above.

### What actually fails to match

Re-measured on the whole local library (5,356 content words, seven works, one of
them a novel). Before this round **215 content lexemes (830 tokens) matched
nothing; now 130 (565).** What closed the gap:

- **2004 print forms, folded before tokenizing** (`src/lib/text/variants.ts`).
  Kadokawa prints 繫 摑 吞 搔 啞 剝 嚙 瘦 顚 鹼, IPADIC knows 繋 掴 呑…, and every word
  written with one fell apart into a junk kanji and a stray suffix. Surfaces keep
  the book's glyph; lemmas are folded.
- **Derived forms** (`src/lib/dict/derive.ts`), tried only when the lemma matched
  nothing and each gated on the JMdict tags its result must carry: potential
  verbs to their godan plain form (会える → 会う, 58 lexemes), と-adverbs to the
  stem, ない-adjective stems to the adjective, classical サ行 verbs to する. A
  lemma opening on づ/ぢ is a rendaku suffix and is not rewritten. Stored as
  `dictMatch = 'derived'`; the entry page says the form is not in JMdict.
- **Runs of unknown marks are symbols.** `!!」`, 〝, 〟 were 名詞 and counted as
  vocabulary; they are now split and filed as 記号 — which also fixed a
  segmentation bug, since `!!」` as one token hid the closing quote.

What remains, largest first: **names** (遥, チハル, 三枝, ハル, 一ノ瀬 — now fixable
from the reader), **Latin and numbers** (ＭＶ, ＫａｍｉＵ, 2026), **flattened ruby in
pasted text** (溜, 憐, 摑 in `摑づかみ`), and a tail of real mis-analyses
(羨い/トモイ, 差しかかる, こんなにも, 本当は as a conjunction).

### Flattened ruby corrupts an import

**EPUB import removes this at the source, for EPUBs.** `xhtmlToText` keeps
`<rt>` as ruby markup rather than prose, so 頷 arrives as 頷 with its reading on
the side (see “Book ruby and names”). Pasted text in Aozora notation
(`頷《うなず》`) is read the same way. The note below still stands for pasted text, which is
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
furigana alignment and the Q&A prompt's token table are all built on.

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

**Glosses are checked before they are written** (`src/lib/translate/check.ts`).
The count was the only check, and on 11,429 translated senses 19 carried
Simplified characters (各种各样), 52 left English behind (過早； premature), a
few used mainland words (視頻, 用戶, 自行車), and 743 opened on a part-of-speech
label the English never had — （助詞）, sometimes wrong. Labels are stripped; the
rest is refused and sent back with the reason on the retry. The reject lists
leave out characters Taiwan also writes (拮据, 温, 况, 鎮), and scientific
names and brands the English carries (Felis catus, Post-it) pass. `npm run
db:translate -- --recheck` applies the checks to stored glosses: locally it
stripped 739 labels and requeued 51 senses.

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

Repeated failures were observed keeping Ollama busy with 45 entries pending:
the same first five rejected entries were selected on every lap. The server now
remembers entries rejected twice, per provider/model, for its lifetime (including
development module reloads). Selection skips them before taking the five-entry
chunk, so later entries proceed and page polling cannot restart the failed work.
Their glosses stay null and the English fallback remains; a server restart or a
different model permits a fresh attempt. Network failures and interactive aborts
are not recorded as rejected translations. No persistent queue table is needed.

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

**Ruby is kept apart from the prose, and that is the point.** Flattened
furigana — the largest class of unmatched word in the first corpus, and a
corruption of the Dictionary rather than only of matching — cannot happen for a
book. It used to be thrown away, on the grounds that the analyzer owns
readings; it is now kept as markup, because the book's reading is right exactly
where the analyzer's is a guess. See “Book ruby and names”.

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

### A grouped 〟。 drifted every offset after it

kuromoji places each 、/。-delimited piece at the *start* of the previous
piece's last token, and 〝…〟 is an unknown symbol that groups with the mark
after it. In カミュの歌鳥 that moved every later token of two parts one character
early: 84 sentences opened with the previous 。 or newline, 1,504 token rows
failed `text.slice(charStart, charEnd) === surface`, and the merged 〟。 hid a
sentence end. The reader looked fine, because it prints surfaces; the Dictionary
quoted `。生身の…` with the highlight on `に満`, and Q&A was handed the glued text.
The analyzer now places tokens by their surfaces (see `.claude/rules/analyzer.md`).

**Existing imports are rebuilt in place** by `npm run db:retokenize`, from the
`sourceText` import kept for this. Detection is the offset invariant itself, so
it finds nothing on a healthy database and is safe to run again. The section row
survives; the bookmark follows by overlap. Measured after the rebuild: all 48
sections match a fresh analysis exactly, and none was reopened for resolution.

**Rejected: delete and re-import.** It needs the EPUB again, and throws away read
stamps and bookmarks for a fault confined to two parts. **Not built: refreshing
downloaded copies.** An offline chapter is a snapshot and keeps the old rows until
it is downloaded again.

### Chapter navigation

The Library links to one section per work, so without a list carried into the
reader chapter seven is unreachable. `getArticle` returns every section of the
work; the reader draws a collapsed 目次 above the prose and the neighbours below
it, and draws neither when there is only one section. A chapter still resolving
is printed but not linked — the same reason the Library greys a row.

### Numbered parts inside a chapter

A chapter runs 5,000–30,000 characters, which was too long a sitting. Neither
sample book lists its sections in the contents — the NCX stops at chapters —
but both number them in the prose: カミュの歌鳥 with a bold `１` on its own line,
神椿市建設中。 with `【１】`. `splitParts` splits on a line that is only such a
number, and only when a chapter has **two or more** (神椿's epilogue carries one
lone heading). Kanji numerals count only inside brackets, since a bare `三` on a
line is prose. Text before the first number joins the first part. Measured: 21
of 24 chapters split, into parts of roughly 1,000–5,000 characters.

The rejected alternative was keeping the chapter whole and drawing the numbers
as headings in the reader; nesting was chosen because the part is the more
comfortable reading length.

The chapter becomes a **heading row** — `section` with a title, no sentences,
no `sourceText`, resolved on arrival — and its parts carry `parentId`.
`orderIndex` is reading order across the whole work, heading before parts, so
every walk of a book still sorts one column. The heading is stamped resolved, so
the Library filters to leaf sections (`leafSection`) or an unread book would open
on an empty page; `sectionCount` counts chapters, not parts. Standing alone, a
part is named `章名（２）` (`sectionLabel`) — in the 目次 under its chapter, the reader's heading, the
footer neighbours, and Dictionary occurrences. A URL to a heading redirects to
its first part.

`＊　＊　＊` scene-break rows are still read as sentences; they do not split.

### Not built

- **A chapter picker.** Importing is all-or-nothing, and a sixteen-chapter book
  is a large commitment to a serial drain. The parser already reports each
  chapter's length for exactly this, and nothing uses it yet.
- **Appending to an existing work.** Every import creates a new work, so a novel
  pasted chapter by chapter is still six unrelated Library rows.
- **A nested contents.** Still flattened: entries pointing into a file already
  claimed are ignored. Parts come from the numbers in the prose instead, which
  is what the sample books actually have.
- **Re-splitting a book already imported.** Nesting applies to new imports; an
  existing book stays flat until it is deleted and imported again.

## Book ruby and names — built

**The book's ruby is kept and shown.** EPUB import writes `<ruby>` into the
chapter text as Aozora markup, `｜base《reading》`, so `section.sourceText` —
what every rebuild starts from — carries it with no second store to keep in
step. Import and retokenize strip it before analysis and record each sentence's
spans in `sentence.ruby`. The reader draws the book's reading over the
analyzer's wherever the book gave one; a ruby over several tokens (a split
name) is one `<ruby>` around them. The explicit form takes any reading, since
books gloss as well as read (ＩＣＵ《集中治療室》); the implicit `漢字《かな》`
must be kana, or 《》 title brackets would be eaten.

This bends “the analyzer owns readings”, deliberately and only for display: the
author's reading is not a second guess to reconcile but the answer. Lexeme
identity, matching and the Q&A token table still use the analyzer's. **Not
built:** preferring the book's reading in the word card, or using it to catch
analyzer misreadings (逸らせる as ハヤラセル).

Books imported before this get their ruby from the file with `npm run
db:backfill-ruby -- book.epub`, matched section by section on the prose, keeping
section rows and bookmarks. On カミュの歌鳥 all 42 sections matched.

**Names are confirmed from the reader, per work.** IPADIC splits a name it does
not know into whatever its kanji spell (千遥 → 千 "thousand" + 遥), and kuromoji
takes no user dictionary. The word card on a marked piece offers 標為人名: the
neighbouring tokens are chips to extend the name to, and confirming writes a
`work_name` row and re-analyses every section of that work containing it (16
sections, 4.4 s). The merged token is filed under the `name` lexeme namespace,
so it is never marked, not vocabulary, and never linked to JMdict. Its reading
is copied from the book's ruby on any occurrence in the work — a name is
annotated where it first appears, rarely in the chapter being read — and a
gloss is not taken as a reading. The Dictionary lists names under 人名, where
取消人名 deletes the row and re-analyses again.

Per work, not library-wide, because 千遥 is a character in one book and 千 plus
遥 anywhere else. An automatic rule (a number kanji followed by a given name)
was considered and not built: it covers one pattern and can misfire.

**Not built:**

- **A name whose pieces are all common words** cannot be reached: only marked
  words open a card. None seen yet.
- **Pasted articles** are each their own work, so a name confirmed in one does
  not carry to the next chapter pasted.
- **Offline.** A downloaded chapter offers no 標為人名, having no server to
  re-analyse it, and keeps its old tokens until downloaded again.

## Before this reaches the served database

Everything above changed stored data as well as code. On the machine that
serves the app, after `npm run update`:

1. `npm run db:migrate` — `sentence.ruby` and `work_name`.
2. `npm run db:backfill-ruby -- <epub>` for each book already imported.
3. `npm run db:retokenize` — every section, since the analyzer version changed.
4. `npm run db:relink` — re-matches and re-resolves library-wide (model needed).
5. `npm run db:translate -- --recheck` — strips labels, requeues failed glosses.

**Done on daniel-nucbox-k12 on 2026-09-17**, with the database copied to
`~/backups/yomu/` first: ruby backfilled into 41 of 42 sections, every section
retokenized, unmatched content words 133 → 116, all 187 ambiguous lexemes
re-resolved, 709 gloss labels stripped and 49 senses requeued. Delete this
section once the same has run anywhere else it needs to.

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

**A book downloads from its contents list, one control per chapter.** The
chapters you have not opened are only titles on the page, so those rows fetch
the chapter from `GET /api/read/[sectionId]` — the same `Article`, refused with
409 while the chapter is still resolving — and write it once the whole payload
has arrived. A single article keeps its control above the text and still copies
from memory.

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

**Resuming glides back** rather than jumping, so you can see where the page
took you. It jumps instead when reduced motion is on, or when the tab opened in
the background, where there are no frames to animate in. Saving waits until
the glide has stopped moving, not for a fixed delay, because a jump deep into a
long chapter takes longer than any fixed delay.

**After opening, only scrolling saves.** Scrolls in the first 800 ms are ignored: the resume
itself, a jump to a `#sentence-` anchor, the browser restoring a reload's
offset. A Dictionary occurrence link wins over the saved position and does not
overwrite it. Saves happen after a second of stillness and again with
`keepalive` when the page is hidden. It is kept apart from `lastReadAt`, which
waits ten visible seconds so background tabs cannot reorder the Library. A
background tab cannot scroll, so this needs no such wait.

**Switching chapters raised three problems.**

- **Reaching the 目次 reset the chapter you were leaving.** The contents list
  sat above the text, and scrolling up to it counted as reading back to the
  first sentence. The list now **sticks under the header** once scrolled past,
  so it can be reached from anywhere in the chapter. Two other fixes were
  tried and dropped. Treating the space above the text as "no position" meant
  a chapter never started at its first sentence. Moving the list into the
  floating settings menu hid it. The top of the page counts as the first
  sentence again. The reading line sits below the stuck bar, so a resumed
  sentence lands clear of it rather than underneath.
- **A finished chapter never saved its end.** The last screenful can never
  reach the reading line: on a phone-sized screen, 371 of a chapter's 373
  sentences did. At the bottom of the page the last sentence now counts.
- **The Library followed you into a new chapter only after ten seconds.**
  Arriving from another reader page (`document.referrer` under `/read/`) now
  stamps `lastReadAt` straight away, but only while the page is visible, so
  background tabs are still covered by the ten-second wait. This is the one
  part not seen working in a browser: the test pane was hidden, which takes
  the ten-second path, as it should.

**A chapter with nothing saved records its first sentence on open**, so moving
into a new chapter marks it started without waiting for a scroll. A chapter
that already has a position keeps it until you scroll, and a `#sentence-` link
records nothing on open.

**Offline copies keep their own position**, in the small summary record rather
than in the megabyte article, and every save writes both places when the chapter
is downloaded. The two can drift apart: a position recorded offline never reaches
the server. This is the same trade as a 生詞 mark made offline, left unsynced for
the same reason. Unverified in a browser, because development registers no
service worker.

**The Library shows 已讀 N% under the last-read time.** It counts sentences.
For a book, every chapter before the one the row opens counts as read, plus the
position inside that chapter. Read out of order and the figure is wrong, but
recording which chapters were finished would be a second record nothing else
needs. Earlier chapters count only once the work has been read: an unread book
opens at its first *readable* chapter, which may not be chapter one, and those
earlier chapters were never read. No saved position shows no figure rather than
0%.

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

## Grammar — measured, not built

The earlier design — entries created during Q&A, with the agent deciding
novelty — was wrong and has been removed. Vocabulary dedups on a natural key the
analyzer derives mechanically; a model inventing names for grammar points
produces near-duplicates that only become visible once the collection is large
enough to matter. The two candidates for a key were token-stream patterns and a
fixed inventory the model selects from. **Measured against real reading, the
answer is both, in sequence: an inventory that already carries its patterns,
matched in the sentence you ask about, with the model only choosing among the
matches and you deciding what enters the library.**

**The key is the L2 id of 「つつじ」**, 松吉・佐藤's dictionary of Japanese
functional expressions (v1.1u, CC BY-SA 4.0, a 1.2 MB zip from the
[TEU language media lab](https://sites.google.com/edu.teu.ac.jp/cl-lab/%E7%A0%94%E7%A9%B6/%E8%A8%80%E8%AA%9E%E8%B3%87%E6%BA%90/%E6%97%A5%E6%9C%AC%E8%AA%9E%E6%A9%9F%E8%83%BD%E8%A1%A8%E7%8F%BE%E8%BE%9E%E6%9B%B8%E3%81%A4%E3%81%A4%E3%81%98)).
It has 341 headwords, 435 L2 meanings and 16,801 surface forms. Its nine levels
are exactly the variation a dedup has to collapse:

| Level | Separates | Example |
|---|---|---|
| L1 | Composition (headword) | にとって |
| **L2** | **Meaning** | ながら "while" / ながら "although" |
| L3 | Function | に対して / に対する |
| L4 | Function-word alternation | |
| L5 | Phonetic change | てしまう / ちゃう |
| L6 | Inserted とりたて詞 | に対して**は** |
| L7 | Conjugation | |
| L8 | With or without です/ます | にとりまして |
| L9 | Spelling | に対して / にたいして |

L2 is the learning item: everything below it is form, and above it meanings
merge. Ids are prefixes (`0011P.1xx.01n01` → `0011`), so any matched form
reduces to its key by truncation. 199 意味的等価クラス group paraphrasable
L2s (から / ので / ものだから) — "similar grammar" and quiz distractors, **never a
merge**. Each L2 carries a difficulty (A1, A2, B, C, F; F is undocumented and
formal or archaic in practice), and 162 carry an id in the pre-2010 JLPT
出題基準.

**It speaks IPADIC.** Its connection constraints are full IPADIC feature
strings — `動詞,*,*,*,*,連用タ接続,*` — which is what kuromoji already stores in
`token.features`, so candidates come off the existing token stream with no
patterns to author. LEFT constrains the token before the expression, RIGHT the
expression's own last token, and the trailing `90` on every code is unused.
This makes the analyzer harder to swap: `src/lib/analyzer/types.ts` calls UniDic
a one-file change, which stops being true once grammar matching exists.

**Not in it**, found by probing and by the measurements below: てみる, causative
させる, the passive, suffixes (がち, っぽい, だらけ), 様態 そう, ～かける,
～に見える, "wondering" だろうか (its only だろうか is rhetorical), and
directional てくる / ていく (its entries are aspect only, so 近づいてくる is
arguably not them). These need a small supplement in the same record shape
under a `yomu:` id prefix, written by hand and never by the model.

**JMdict is a cross-reference, not a key.** 324 of the 435 L2s have a surface in
JMdict (178 tagged `exp`), but one JMdict entry spans several meanings and knows
nothing of variants. Nothing collides with vocabulary: kuromoji never emits
these expressions as a single token.

### The flow: asked for, one sentence at a time

**Grammar is found when you ask about a sentence, never by analysing a work.**
The reader double-taps a sentence, and alongside the explanation the card offers
the grammar points that sentence contains; each is a card you add to the grammar
library by hand, or ignore. Nothing is filed by a background pass, and nothing is
added without a tap — the same shape as confirming names in “Book ruby and
names”, and the same reason: the confirmation is cheap for you and the automatic
version is wrong often enough to matter.

That makes recall the number to optimise and precision the number to keep
honest. A missed point costs you a card you never see; a wrong card costs a tap
and, if you take it, a wrong entry in the library. What you must be able to do
is judge it, so a card shows the span in its sentence and the meaning in
Chinese, not a bare id.

**Adding is what stores anything.** Q&A still streams and is discarded. The add
writes the entry (keyed on the L2 id, so ちゃう and てしまう land on one row) and
the occurrence it came from: sentence, `sentenceRevision`, token range. Meeting
the same point again offers 已在文法庫 — 加入這個例句 rather than a second entry.
The card's footer note has to change with it: 不會儲存 — 關閉後即消失 is true of
the whole card today and stops being true the moment a point can be added.

**The cards arrive as their own bubble in the thread**, not as a strip pinned
above the composer. Both were mocked; the panel is compact — a bottom sheet at
76vh on a phone — and a permanent strip spends that height on every sentence,
including the sixth that has nothing to offer. A bubble costs height only when
there is something to show, and it reads as what it is: the panel saying what it
found in this sentence.

That settles the timing. **Identification starts when the card opens**, not when
you ask, so the ~8.5 s runs while the templated greeting is on screen and the
bubble lands before the first question — a strip could have filled in quietly
either way, but a bubble arriving mid-conversation would interrupt one. It also
lets the points be handed to the explaining prompt, so the prose covers the same
points the cards offer.

**A bubble scrolls away, which is its one real cost.** Adding is exactly what
you want after three follow-ups, so the chips row keeps a ↑ 文法 2 chip that
scrolls back to it. A row expands in place inside the bubble to show the span
marked in its sentence (…悪目立ちし【ないようにし】ている), the difficulty, and
the 意味的等価クラス peers — enough to judge the card, since the matched span is
often a fragment and a fragment alone is unjudgeable. The reject is 這不是這個
句型, and off-list proposals sit under a 未收錄 line with no add control.

**Nothing in the reader is underlined for grammar.** The dashed line means
"JMdict does not call this common" and must keep meaning only that.

### Measured: finding the points in one sentence

On the local library (4,664 sentences, 7 works), matching exact surface
sequences under LEFT/RIGHT and keeping maximal spans:

- **20,402 spans, in 95% of sentences** — mostly single A1 particles. 3,227
  multi-morpheme spans over 123 L2s, and 3,703 single-morpheme spans above A1.
- **200 spans labelled by hand**: 150 multi-morpheme, stratified at most four
  per candidate set, and 50 single-morpheme above A1. The labels are Claude's,
  not a native annotator's. Of the 150, 99 had the right candidate offered, 32
  were not grammar at all (学生**では**なかった, 目**にして**いた,
  送信された**もの**だった), and 19 were grammar with the wrong candidates
  offered (帰ら**なければ**いけない got only ないと).

Precision is the share of offered cards that are right, recall the share of real
points that get a card. Over all 200 labelled spans:

| | precision | recall |
|---|---|---|
| Matcher, first candidate | 60% | 83% |
| Matcher, only when unambiguous | 72% | 70% |
| `qwen3.8:27b`, one span per request, Tsutsuji labels shown | 87% | 68% |
| Same, Chinese glosses shown | 86% | 79% |
| Two prompts required to agree | 94% | 64% |
| **One request per sentence, all its spans at once** | **85%** | **91%** |

**The whole sentence in one request is the right shape**, and not only for
latency. Judging a span against its neighbours lifted recall from 79% to 91%
(96% on multi-morpheme spans) at the same precision, because a model that has
already accounted for ている in the sentence stops rejecting てくる next to it.
The model gets every span with its candidates plus "none", a JSON-schema reply,
temperature 0 — the resolver's shape, one sentence wide.

**8.5 s median for a sentence** (p90 11.5 s, worst 23.9 s over 194 sentences),
against 2.3 s per span sequentially. Median 2 spans per sentence, at most 7, and
~500 prompt tokens. That fits beside a Q&A answer, which takes tens of seconds
by itself.

**1.4 cards per sentence** (median 1, at most 4) once lone A1 particles are
dropped, and **16% of sentences offer nothing** — which is the honest answer for
a sentence whose only grammar is a particle, and better than padding the card
with 助詞「に」.

**The matcher is the weak part, not the model.** 10 of the 18 wrong accepts in
the gloss run were spans offered the wrong family; where the matcher offered
the right one, precision was 93%. Prefer the longest match across overlapping
patterns (なければ|いけない, わけ|にはいかない, よう|になる), and add the
supplement.

**What the model is shown decides its recall.** Tsutsuji's own labels — てしまう
is 過去-完了-タ類 — made it reject obvious cases. Traditional Chinese glosses
for the L2s, generated in one pass (55 requests of eight, ~14 s each, one id
dropped),
raised recall from 68% to 79%. They need review before anyone sees them: two
まで meanings came back with the same gloss, and the "even" まで was wrong. They
are display text, never a key, so a bad gloss costs clarity rather than
creating duplicates.

### Rejected: reading the points back out of the answer

The obvious way to get cards out of a chat is to let the model explain in prose
and then mine the explanation. Measured and rejected: it is slower, noisier and
no more accurate than asking about the matched spans directly. 30 grammar-rich
sentences through the app's own Q&A prompt and the 說明文法 chip, then extract
the points named, retrieve candidates (matcher spans in the sentence, then
surface lookup, then `bge-m3` over L2 descriptions), and have the model pick or
reject:

- **249 mentions, 8.3 per answer**: 38% grammar patterns, 31% particles and the
  copula, 16% conjugation forms, 14% vocabulary (ほとんど, 敬遠).
- 79% of the grammar patterns have a Tsutsuji entry. **Link precision 93%**,
  recall of the linkable 64%.
- **137 of the 167 linkable mentions were retrieved through a matcher span in
  the same sentence**, and for 122 of those the span already offered the right
  entry. Q&A mostly re-finds what detection already found. What
  remains is generic (連體修飾節, て形) or a few real gaps (に見える, 様態 そう,
  かける), which the supplement covers. Extraction adds ~16 s to a ~43 s answer.

So the cards come from the matched spans, not from the prose. The two can still
agree: identification is one short structured call, so it can run **before** the
explanation streams and be handed to the explaining prompt as the points to
cover.

**The off-list proposals are worth keeping, and are not entries.** Asked for
grammar it can see beyond the offered spans, the model proposed 22 points over
194 sentences (15 sentences had any). Some are real gaps — ～てよかった, ～ようだ,
～とはいえ, ～に合わせて — and some are vocabulary in disguise (～込む, よく). They
show on the card as explained-but-not-addable, because an addable one would be a
model-named entry, which is the design that failed. They are the worklist for the
hand-written supplement.

### Direction

1. **Import Tsutsuji** the way JMdict is imported: a fetch and an import script,
   the source in the gitignored `data/`, an attribution notice like
   `EdrdgNotice`. ShareAlike applies to anything derived from it and distributed
   — the reviewed glosses included.
2. ~~**Match one sentence**~~ — **built**. `src/lib/grammar/match.ts` takes a
   sentence's tokens and an inventory and returns the spans, longest first and
   never overlapping; `inventory.ts` holds the shapes and resolves つつじ's
   connection classes. Pure, and the inventory is an argument, so the tests run
   on a hand-cut corner of つつじ rather than needing the gitignored `data/`.
   No table and no background pass: spans are derived on demand, the way the
   reader derives everything else. Not yet re-scored against the labels — that
   needs step 1, and the lemma the matcher still ignores is why ていく and
   てくる both match てき.
3. **Identify on ask**: one structured call for the sentence, through
   `priority.ts` as interactive work, before the answer streams.
4. **Cards in the Q&A panel**, each with its span in the sentence and a Chinese
   name and gloss. Adding writes the entry and the occurrence; a point already
   in the library offers its example sentence instead.
5. **Grammar in the Dictionary**, listed apart from vocabulary the way confirmed
   names are, each point with the sentences you added and its
   意味的等価クラス peers alongside.
6. **Review last**, keyed on L2, sharing whatever schedule vocabulary gets — one
   quiz, two kinds of item, rather than two schedulers.

**Open, not measured:**

- **What a rejected card does.** 這不是這個句型 can dismiss the row for now, or
  be remembered so that span stops being offered on that sentence — which is a
  stored judgement, and the first thing Q&A would keep besides an add.
- **Whether a card can be added from a wrong sentence.** The span is what is
  stored; a user who adds ～ては from 嫌な感じ**では** stores a bad example, and
  nothing yet notices.
- **Whether A1 particles are ever cards.** Dropped by default here. Tsutsuji has
  eight meanings of に, and 83 of the 211 A1 accepts in the measurement were に.
- **What "identify" costs on a phone over the LAN**, where Q&A already feels
  slow.

The labels live in `data/grammar-labels.json` — 200 spans, each with its
sentence, character offsets, the candidates it was offered and the label. Not
committed, because the sentences are copyrighted book text, the same reason
EPUB fixtures are built rather than checked in. Offsets are into the sentence
text rather than token indices, so re-tokenizing cannot move them; that has
already happened twice mid-measurement.

`design/grammar-cards.mock.html` is the card design these numbers are for, hand
written rather than exported from the design canvas, and worth deleting once
the panel exists.

## Deferred

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
