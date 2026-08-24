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

The LLM resolver now settles this at import (`src/lib/dict/resolve.ts`): it fires
only on `lemma_reading_multi` where the survivors' leading glosses actually
differ, hands the model one occurrence sentence and the surviving entries, and
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

`design/*.dc.html` is committed and reads as current. Three places it is not,
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
  round-trips. Revisit batching only if import latency against a live model bites.

The card showing all senses with nothing auto-picked, and the deferred
per-occurrence `token.senseIndex`, both still hold — the analyzer's POS already
discards irrelevant senses and JMdict orders the rest by commonness.

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
- Whether the reader must work when the model host is unreachable. Lazy
  translation assumes it need not; if that is wrong, the common subset should
  be pre-translated instead.
- Transcriber choice — prefer one emitting per-segment confidence and timings,
  since `sentence.confidence`, `startMs` and `endMs` already exist for it.
