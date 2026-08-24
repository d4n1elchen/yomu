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
JMnedict: 13.4 MB of names, larger than JMdict itself; deferred until we can
count how many unmatched words in real reading are actually names.

### Homograph ambiguity — what is left of it

Grammar settles most of this. `lexeme.posDetail` and `conjugationType` carry
IPADIC's finer answer, and the matcher narrows candidates by mapped JMdict POS
before frequency gets a vote — 一段 against `v1`, 接尾 against `suf`. That fixed
この (was 九, "nine"), さん (was 三, "three") and いる (was 入る, "to enter").
They sit outside the lexeme identity key, so nothing re-files and no lexeme is
split by a POS that varies between sentences.

What remains is entries sharing lemma, reading **and** grammar. なる is the
whole of it today: 生る "to bear fruit" at nf07 against 成る "to become" at
nf34, both `v5r,vi`, both `uk`, both flagged common. Nothing in JMdict
separates them, and frequency actively points the wrong way.

Measured on the current corpus: **5 of 34** content words carry
`lemma_reading_multi`, and **1** is actually wrong. The flag means several
candidates survived, not that the pick is bad — two of the five choose between
entries with the same gloss. That denominator is one five-sentence article and
is far too small to be a rate; it needs a real book, like everything else here.

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

**A JMdict fallback for words matching nothing.** There is nothing to fix: 0 of
34 content words are unmatched. And the naive rule was wrong 2 of 3 times on a
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
  the state the card was already built for.

Resolution is also the cheap one: 33 requests against 459, about 7% of the work.
Gating on the small structural pass and letting the large cosmetic one run free
is what makes this cost nothing.

**Recovery is a page load.** Opening the Library calls `ensureDraining`, which
picks up every unresolved section and every untranslated entry, whatever import
left them behind — so a drain killed by a server restart resumes by itself.
Verified by stranding an article (importing through a script, which never fires
`after()`) and watching a single Library visit finish it. `npm run db:translate`
does the same on demand.

Three details that make it safe: a module-level flag keeps one drain in flight
(better-sqlite3 is a single synchronous connection, so there is no second worker
to coordinate with, and the writes are individually guarded anyway); a two-minute
backoff stops a downed host being retried on every page view; and both passes
work at **whole-database scope**. That last one was a real bug in the first cut
— scoped per-import, an entry left untranslated was never revisited unless a
later article happened to contain it too.

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

### Still open: batching

459 sequential requests per chapter is the measurement that reopens the 5–10
entries-per-request idea the first plan sketched. It is the only lever left,
since server-side parallelism is off the table for this model family. The cost is
that per-entry count validation has to move inside a batched reply. Deferred
until the background drain has been lived with — the wait is now invisible, so
throughput may simply not matter.

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

**Also deferred:** JMnedict, URL and file import, transcription.

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
