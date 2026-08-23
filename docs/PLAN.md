# Yomu — plan

What is decided and not yet built. Git history covers what happened; this
covers what is next and why. Delete sections as they ship.

## Naming

**Library** is the list of articles. **Dictionary** is vocabulary (and grammar
eventually). Never "lesson" — this is an article reader; "lesson-style" only
ever described the presentation.

Adding an article is its own page, not a dialog and not on the home screen.

## Phase A — UI restructure

Fully decided, no new data required.

- Rename throughout: Library (articles), Dictionary (vocab). Routes follow.
- `/new` as a standalone page.
- **Furigana is always on.** Remove the toggle.
- The switch in the reader controls **word explanations**, not furigana.
- Replace the per-sentence `?` button with selection-based Q&A (below).
- Add `last read` to the Library list.
- Fold in: drop `kuromojin` (see "Loose ends").

### Selection-based Q&A

Select any text in the reader; a card opens. Desktop places it near the
selection, mobile as a bottom card — the same split already chosen for word
explanations.

- Selections may span sentences. All covered sentences and their tokenization
  go to the model as context, so a fragment is still explained in context.
- Our offsets are sentence-relative, so a browser selection has to be mapped
  back onto token spans to recover which sentences it covers and where. Each
  token span carries its sentence id and offsets, which is what makes this
  tractable.
- Suppress the word hover card while a selection exists or is being dragged,
  or it pops up over the text being selected.
- `rt { user-select: none }` matters more now that furigana is always on —
  without it, selecting 食べた yields "食たべた". Already in the CSS; verify it
  empirically rather than trusting it.
- On mobile the OS Copy/Look-Up menu appears alongside our card. Accepted —
  suppressing it means reimplementing text selection.

### Last read

Stamped after **10 seconds** in the article, with the timer paused while the
tab is hidden so background tabs do not count. Recorded on `section`, not
`work`: for a one-section article they are the same, but a book needs to know
which chapter you were last in. The Library row shows the most recent across a
work's sections.

### Library columns

Title · Last read · Vocab · Grammar. Grammar reads zero until grammar exists.

## Phase B — JMdict import

No LLM in this phase. Ends with dashed underlines working on real frequency
data.

**Two files, one source.** The simplified JSON (11 MB) for structure and
English glosses, plus a single scan of the original JMdict XML for frequency
rank. Both carry the JMdict entry id, so they join with no matching work.

The XML pass is necessary because jmdict-simplified collapses `nf01`–`nf48`
into a binary `common` flag — and 95% of real reading vocabulary is flagged
common, which cannot drive a slider. The bands are 500 words each covering the
top 24,000; anything rarer carries no band, which is itself a difficulty
signal. Roughly 49 usable levels.

- Delivered by a setup script into a gitignored `data/`.
- Tables: `dict_entry`, `dict_sense`.
- Link `lexeme` rows to their matched entry, matching on lemma **and** reading
  (reading disambiguates homographs like 人気 にんき / ひとけ). kuromoji gives
  katakana, JMdict gives hiragana — convert deliberately.
- Measured match rate against our existing lexemes: **94.8%** on lemma+reading,
  1.7% lemma-only, 2 misses in 58 words (`Kubernetes`, and `野家` from a
  mis-segmentation). Re-measure once a real book is imported.
- EDRDG attribution in the Dictionary footer — a licence condition.

**Rejected:** BCCWJ (a balanced corpus and better data than newspaper
frequency, but UniDic lemmas would reintroduce the matching problem we just
measured away — revisit only if marking feels wrong for fiction). JMnedict
(12.8 MB of names, larger than JMdict itself; deferred until we can count how
many unmatched words in real reading are actually names).

### Hard-word marking

Frequency rank drives the dashed underline, behind an **adjustable slider** —
one number in the query, and it lets you tune per text, since news and fiction
need different levels.

## Phase C — Chinese glosses

There is no free Japanese→Traditional Chinese dictionary. JMdict has no Chinese
glosses at all, and Chinese Wiktionary (84k Japanese entries) has real coverage
gaps and inconsistent Simplified/Traditional. So the Chinese comes from the LLM.

**It translates, never defines.** Given a real JMdict sense to render, it can
mistranslate, but it cannot invent a meaning the dictionary never had. This is
the same grounding rule that fixed the Q&A prompt after every model tested
invented readings (qwen3.8 rendered 窓の外 as まどのはら).

- **Lazy**: at article import, translate the senses of words that appear and
  have no Chinese yet. Not on hover — that turns every unfamiliar word into a
  stall at the worst moment.
- **The queue is `glossZh IS NULL`.** No separate table. If the model host is
  unreachable, entries stay null and are picked up next import; reading never
  blocks.
- **One entry at a time, all its senses**, so sense structure stays intact.
  Batch 5–10 entries per request; larger batches lose input/output alignment.
- **Validate the sense count returned equals the count sent.** Retry once, then
  leave null and move on. Use Ollama's structured-output option rather than
  trusting free text.
- Store `glossEn` beside `glossZh`, plus the model that produced it — a
  mistranslation is invisible in a way a wrong reading is not, and provenance
  is what makes a later re-translation of a subset possible. Same reason
  `section.analyzerId` exists.
- The card shows all senses; nothing picks one automatically. JMdict orders
  senses by commonness and the analyzer's POS already discards irrelevant ones.
  A per-occurrence `senseIndex` on `token` stays available but unbuilt.

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

## Loose ends

- **Drop `kuromojin`.** Of the three things it offers — promise API, tokenizer
  singleton, result cache — we use one, duplicate one, and bypass the third by
  calling `tk.tokenize()` on the instance. Replacing it is five lines around
  `kuromoji.builder`. It also contributed the `isLoading` latch that made
  tokenization unrecoverable without a server restart. Removing it deletes a
  paragraph from `.claude/rules/analyzer.md`.
- Two comments still teach the wrong thing: kuromoji splits 食べた into 食べ +
  た and never returns タベタ for one token. `src/lib/analyzer/kuromoji.ts:68`
  and `src/lib/text/furigana.ts:15`.
- No `.gitattributes`, so every file is CRLF-converted on commit.
- `.claude/launch.json` carries a LAN IP; arguably belongs in `.env.local`.

## Open questions

- Which Ollama model beyond `qwen3.8:27b`.
- Whether the reader must work when the model host is unreachable. Lazy
  translation assumes it need not; if that is wrong, the common subset should
  be pre-translated instead.
- Transcriber choice — prefer one emitting per-segment confidence and timings,
  since `sentence.confidence`, `startMs` and `endMs` already exist for it.
