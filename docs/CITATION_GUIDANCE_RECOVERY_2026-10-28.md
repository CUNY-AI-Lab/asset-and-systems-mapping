# Citation-aware guidance and bounded recovery

The citation-reading and quotation-preservation rules below remain relevant. The account interface and output now follow the November 4 [node submission contract](NODE_SUBMISSION_WORKFLOW_2026-11-04.md): no model relationships or guidance queue, and incremental requests validate evidence against the supplied changed passages or explicit full-current-source fallback. Repair must retain the update identity context and cannot import evidence withheld from that request. Older review/Map Check examples and dated receipts are legacy context, not current account workflow or new deployment evidence.

The October 28 review of the supplied meeting notes identified a report that citation-bearing PDFs produced worse guidance than pasted text without references. The implementation treats text extraction, source interpretation, and provider recovery as separate checks.

`src/pdfMemo.js` restores spaces between positioned word runs and retains inline citations and reference text. `shared/memo-source.js` recognizes reference lists from explicit headings and corroborating publication details, while retaining uncertain content. `shared/provider-memo.js` prepares a reading copy that omits confidently recognized bibliography sections from provider `memoText`, with an explicit omission notice and offsets referring to the saved original. Inline citations and narrative after the bibliography remain available. This filtering applies to memo review, connection suggestions, and Map Check before excerpt and provider-byte limits. The complete original memo remains saved and exportable. Original input and request-size ceilings still apply. Unusual reference formats require classroom review; this heuristic does not claim universal bibliographic parsing.

`server/app.js` asks the model to distinguish source attribution from participants in the case. A name or publication appearing only in citations/references cannot become a scene node, and a bibliography entry alone cannot serve as scene evidence. Separately described participants remain eligible even if the same name appears in a reference list. Quoted narrative passages retain their inline citations. The deterministic reader follows the same exclusion rule.

One ordinary corrective attempt remains available for completed semantic failures. When that correction still fails source grounding, the server can make one final evidence repair with at most six exact narrative excerpts of at most 480 characters each, selected across the full memo and bounded to 5 KiB of serialized passage data. This repair must quote narrative evidence for each node and relationship. A complete review must pass the full validator. If a completed response still fails on an individual map suggestion, the server may separately validate its nonempty guidance and return that feedback alone, explicitly marked as incomplete and without any map suggestions or model readiness. It never silently converts a bibliography entry into case evidence or accepts an unsupported guidance quotation.

All attempts share the request’s original generation deadline and cancellation: 25 seconds for ordinary guidance, or the existing 85-second budget supplied by the verified durable-job context. An out-of-range context value falls back to 25 seconds; request data cannot extend the deadline. A disposable timer and cancellation listener are cleared after generation succeeds or fails, so completed durable jobs do not retain the 85-second timer. Each provider call passes normal admission. Provider refusal, timeout, quota failure, cancellation, ambiguous transport error, and repeated generic schema failure do not trigger evidence repair. Success and failure metadata records the actual `correctiveRetries` count and optional `evidenceRepairAttempts` count. These counts travel with the review; payload content and credentials remain outside logs.

## Verification

Focused source tests:

```sh
pnpm exec vitest run shared/memo-source.test.js shared/provider-memo.test.js shared/meso-source-details.test.js server/memo-citations.test.jsx server/assignment-guidance.test.jsx server/preflight.test.js server/ollama.test.js src/domain.test.js
```

They cover citation-bearing pasted/PDF text, full-source preservation, reference-only people and evidence, a cited person who participates, narrative after a bibliography, bounded late-memo passages, a successful targeted repair, failed repairs, cancellation, and absence of extra calls after quota/timeout/transport/schema errors.

The opt-in paid comparison uses the existing owning-Gateway loopback acceptance helper on port 8796. Start that helper from the Gateway repository using its documented procedure, then run:

```sh
SYSTEMS_MAPPING_LIVE_GUIDANCE=1 SYSTEMS_MAPPING_LIVE_CITATIONS=1 pnpm exec vitest run cloudflare/guidance-live.test.jsx -t citation-comparison
```

The harness compares the already admitted `glm-5.3-flash` and `gpt-oss-20b` models with the same five synthetic citation cases, including extracted three-page PDF text and equivalent pasted prose, without fallback substitution during comparison. It records model, case ID, elapsed time, response status, suggestion counts, and attempt counts. A test credential is issued through the existing helper and revoked in teardown. This is provider acceptance with a temporary application identity, distinct from a signed-in classroom session. Run real student materials only within their authorized handling and retention boundary.


The current assignment adds optional structured relationship details. Model transport may represent unknown optional text or enum values as `null`; these become empty text or `unknown`. Explicit direction synonyms such as `bidirectional` normalize to `both directions`. Other invalid values remain validation failures, and all evidence checks apply after normalization. The original memo and evidence quotations remain unchanged.

The assignment comparison is separately enabled:

```sh
SYSTEMS_MAPPING_LIVE_GUIDANCE=1 SYSTEMS_MAPPING_LIVE_ASSIGNMENT=1 pnpm exec vitest run cloudflare/guidance-live.test.jsx -t assignment-comparison
```

It checks both admitted models on a Meso example with a two-way exchange, documented family count and missing pair, and an Exo funding chain. `SYSTEMS_MAPPING_LIVE_DETAILS=1` adds connection keys and process fields only for these fixed synthetic fixtures, including rejected completed outputs; ordinary and classroom source content stays outside logs. Safe semantic rejection reasons identify which contract needs correction. These acceptance checks retain substantive assertions even when a provider omits useful details.


`SYSTEMS_MAPPING_LIVE_DURABLE=1` runs the same comparison with the existing 85-second verified durable guidance budget supplied to both the local application and Gateway adapter. The receipt labels this `local-verified-durable-budget`. This checks the actual generation budget, while saved-job polling and signed-in classroom operation still require their separate acceptance paths. Ordinary comparisons retain the 25-second budget.

The Meso validator ties strength, channel, family count, direction, and absence claims to narrative sentences that explicitly name the same endpoint pair and describe the relationship. Watching a number of families, holding a phone, or looking in both directions does not establish those relationship details. A count in an adjacent sentence about that pair can support the relationship even when its rationale quotes a different same-pair sentence. Details from another pair are rejected. Explicitly documented details that the model omits trigger bounded correction; the application does not fill them into generated output. Conflicting counts or strengths stay unknown, and an observed exchange remains distinct from a missing channel for the same pair. Ordinary rationale text may faithfully paraphrase a status established by explicit same-pair source evidence; contradictory status claims are rejected, and final evidence repair still requires exact quotations.

The focused reference-volume comparison uses identical narrative with and without 1,800 synthetic Works Cited entries, including narrative after the list:

```sh
SYSTEMS_MAPPING_LIVE_GUIDANCE=1 SYSTEMS_MAPPING_LIVE_BIBLIOGRAPHY=1 SYSTEMS_MAPPING_LIVE_DURABLE=1 node node_modules/vitest/vitest.mjs run cloudflare/guidance-live.test.jsx -t bibliography-comparison
```

The harness verifies the actual provider reading copy before calling each admitted model, and verifies complete original-source storage after success. Its four cases supplement the citation and assignment receipts; they do not replace earlier failed results.

Before Meso generation, `memoContext.mesoEvidence` supplies at most eight source pairs within 2 KiB of UTF-8 JSON, with up to two exact passages per pair and only unambiguous relationship details visible in those passages. Later contradictory source sentences suppress a scalar even if those sentences fall outside the displayed excerpts. This aid accompanies memo review, connection suggestions, and Map Check as source data, and stays available during corrective attempts. It cannot bypass output validation or automatically fill a generated connection. If the combined final-repair context would exceed its unchanged 8 KiB ceiling, later repair passages are removed while preserving the source-pair aid.
