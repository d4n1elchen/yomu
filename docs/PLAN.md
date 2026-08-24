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

**Rejected, and still rejected.** BCCWJ: a balanced corpus and better data than
newspaper frequency, but UniDic lemmas would reintroduce the matching problem
lemma+reading measured away — revisit only if marking feels wrong for fiction.
JMnedict: 13.4 MB of names, larger than JMdict itself; deferred until we can
count how many unmatched words in real reading are actually names.

### Homograph ambiguity — the known limitation

Matching on lemma **and** reading cannot separate two entries that share both.
入る and 居る are both いる, both flagged common, and neither is ranked, so every
いる in a text links to whichever the tiebreak prefers. Measured at **7 of 48**
reading-matches in the current corpus.

These are stored as `dictMatch = 'lemma_reading_multi'` rather than passed off
as clean, and the Dictionary entry page says so where it shows the senses.

Resolving them needs the conjugation class — v5r against v1 — which IPADIC has
on the *token* (`features.conjugatedType`) and the `lexeme` does not carry.
Deliberately not built: it changes lexeme identity, and it should wait until
there is enough real reading to say whether the wrong senses actually bite.

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
  blocks. `dict_sense.id` is derived from (entry, position) rather than
  generated, so re-importing JMdict carries translations across instead of
  discarding them with the rows they were on.
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

## Open questions

- Which Ollama model beyond `qwen3.8:27b`.
- Whether the reader must work when the model host is unreachable. Lazy
  translation assumes it need not; if that is wrong, the common subset should
  be pre-translated instead.
- Transcriber choice — prefer one emitting per-segment confidence and timings,
  since `sentence.confidence`, `startMs` and `endMs` already exist for it.
