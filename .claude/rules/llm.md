---
paths:
  - "src/lib/llm/**"
  - "src/lib/qa/**"
  - "src/app/api/**"
---

# LLM access

All access goes through `src/lib/llm/` — an `LlmProvider` interface plus
`getLlmProvider()`, configured by `YOMU_LLM_PROVIDER`, `YOMU_OLLAMA_URL`,
`YOMU_LLM_MODEL`. Server code only; no host or key may reach the client.

**Never ask the model for a reading.** Every model tested invents them —
qwen3.8 rendered 窓の外 as まどのはら. `src/lib/qa/prompt.ts` hands it the
analyzer's segmentation and readings as fact and instructs it not to produce its
own. Keep that division intact when changing prompts.

**`qwen3.8:27b` is the tested model.** Smaller ones are not viable: a 9B mangled
座る into "座っ (zutta)", called ～ながら a て-form variant, and missed ～ていた
entirely — the sentence's main grammar point.

**Answers stream.** A full response takes seconds to tens of seconds, so
`/api/ask` streams plain text and the client appends as it arrives. Once a
response has begun, a failure has to travel in the body — the status code is
already sent.

**Persist after the stream completes**, with the `sentenceRevision` the question
was asked against and the provider and model ids for attribution.
