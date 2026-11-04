# Two memos and two spheres — November 4, 2026

The workflow keeps four analytical steps and one durable graph. Part 1 uses a local memo: Micro proposes nodes and Meso proposes relationships between them. Part 2 has a separate upload or text field and builds on Part 1: Exo proposes larger-scale heading nodes, then Macro proposes relationships among those headings and groups of local relationships under them. The map draws two spheres, **Microsystem** and **Macrosystem**.

## Sources and continuity

`submission` retains Part 1. Optional `part2Submission` has its own bounded ID, text, file metadata, revision, fingerprint and privacy declarations. New projects initialize both sources; the Meso-to-Exo transition opens Part 2. Existing outer-level projects keep their legacy memo until a student adds Part 2. Adding or uploading Part 2 never clears graph records or copies Part 1 permission into the new source.

Memo upload remains available in the notebook at Meso, Exo and Macro. The reader accepts the existing PDF, DOCX and text formats. A delayed or unsuccessful import cannot overwrite a newer edit, another project, or another work level. Earlier graph IDs, coordinates, evidence, annotations and per-level Field Notes stay saved. Manual editing remains available when model guidance fails.

Outer guidance receives both memos, with reference lists stripped independently for provider context while the originals remain saved. It also receives the carried graph, bounded Field Notes and student decisions. Edits to either source invalidate the combined review fingerprint. Sensitive context requires the applicable permission declarations from both sources. Total provider request limits still apply.

## Relationship groups

A Macro edge may include `relationshipIds`, containing 1–24 distinct exact IDs of live Meso relationships. Its `source` is an existing Exo heading (or a preserved legacy Macro heading). Its `target` is a real endpoint of a selected relationship, retained for compatible edge serialization. **Membership is defined by the selected relationships, not that anchor node.** Ordinary node-to-node Macro links omit this field.

Validation rejects unknown, retired, nested or out-of-scale members and invalid headings or anchors. A referenced local relationship cannot be removed until its group is revised or removed. The canvas draws highlighted bands and vectors from the heading to the selected relationship midpoints. Unrelated nodes are masked from those bands. PNG/PDF exports carry the same memberships and name the selected relationships in the legend.

The model is instructed to try supported groups and larger-scale-to-larger-scale connections without inventing evidence. Students may change the heading, membership, wording, direction and evidence, remove proposals, or create groups entirely by hand. Draft recovery and rereading preserve manual membership decisions. Model output remains an inference until a student judges it. Weak source material should produce specific questions rather than unsupported claims.

## Compatibility and deployment

Schema 10 accepts versions 1–9 and preserves legacy scoped nodes. The analytical IDs `micro`, `meso`, `exosphere`, `macrosphere` and stage IDs are unchanged. No new Durable Object namespace, database migration or service deployment is required. Guidance contract version `two-memos-two-spheres-v6` invalidates incompatible cached reviews. Default prompt modules advance only when their saved fingerprint exactly matches an untouched earlier default; instructor edits remain intact.

Private JSON and Markdown retain both source texts. JSON retains exact group IDs; CSV includes `grouped_relationship_ids`. Broader exports apply source restrictions across both memos. PNG/PDF contain the graph, not source memos or Field Notes.

## Verification boundaries

Unit and route tests cover combined context, source privacy, draft recovery, valid and invalid memberships, provider schema, feedback-only recovery, Map Check context, migration and exports. Browser tests exercise both memo uploads, controlled model proposals, manual groups, regeneration, reload, accessibility and downloads on desktop and phone. Their controlled output establishes application behavior, not live model quality.

The four instructor-provided PDFs are intentionally excluded from Git. Set `SYSTEMS_MAPPING_REAL_MEMOS_DIR` to their local directory to run their Meso-upload browser cases. Fabricated Part 2 examples in `tests/fixtures/two-memo-cases.js` cover Bronx school support, Flushing language access and housing repairs, plus a deliberately vague case. They are test scenarios, not factual policy claims. Real provider acceptance and signed-in Dev/production acceptance must be reported separately from these automated checks.
