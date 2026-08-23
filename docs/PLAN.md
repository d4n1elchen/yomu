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

### The word card becomes a hover card here

Phase A left the word card as a full-width panel pinned to the bottom on every
screen size. Deliberately: the desktop split (a card floating near the word,
mobile keeping the sheet) is decided, but there was nothing to hover over yet
and nothing to put in the card beyond the four analyzer facts. In the mock the
card only fires on a marked word, so marking is what gives it a trigger.

So it is shaped once, here, rather than twice — the anchoring it needs already
exists in `AskDialog`, which measures itself and clamps to the viewport rather
than assuming its own size. Its senses arrive in Phase C.

Phase A did already implement the half of this that the Q&A card depends on:
the word card is suppressed while a selection exists or is being dragged.

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

- No `.gitattributes`, so every file is CRLF-converted on commit.
- `.claude/launch.json` carries a LAN IP; arguably belongs in `.env.local`.

## Open questions

- Which Ollama model beyond `qwen3.8:27b`.
- Whether the reader must work when the model host is unreachable. Lazy
  translation assumes it need not; if that is wrong, the common subset should
  be pre-translated instead.
- Transcriber choice — prefer one emitting per-segment confidence and timings,
  since `sentence.confidence`, `startMs` and `endMs` already exist for it.
