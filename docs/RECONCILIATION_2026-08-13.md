# Reconciliation record — 2026-08-13

> **Historical record.** Claims of “current,” “implemented,” or “verified” below refer to this document’s dated source and environment. The November 4 [Memo workspace](MEMO_WORKSPACE_2026-11-04.md), [two-memo workflow](TWO_MEMO_WORKFLOW_2026-11-04.md) and [classification evidence](CLASSIFICATION_EVIDENCE_2026-11-04.md) govern the account application. Older screen, model-output and sphere rules do not override them; the receipts below are preserved, not rerun acceptance.

## Outcome

Local `main` initially stopped at `7ad83ae`. `origin/main` had advanced to `fd7ca0b` through two README-only commits: `1129313` and `fd7ca0b`. Neither upstream commit changed application code, tests, data, configuration, or deployment behavior.

The implemented five-stage application is the authority for this reconciliation. Checkpoint `4bb915a` captured the previously deployed working tree, and dirty-working-tree Railway deployment `3ea599f4-7fb5-4dd3-998d-c55134a69f15` remains historical evidence. The reconciled tree passed 160 tests with 3 PostgreSQL tests skipped, and the production build passed.

PR [#5](https://github.com/CUNY-AI-Lab/systems-mapping/pull/5) merged the reconciled implementation into `main` at `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`. GitHub `main`, `origin/main`, and local `main` were synchronized at that commit. Railway deployment `39d38543-20ca-4626-95e6-237ef9213881`, built from that clean main commit, reached `SUCCESS`; migration reported ready; root and health returned 200 with expected security headers; class code `101` created a session; public configuration returned Part 1 and Part 2 scale groupings; logout removed the session; exact local/live bundle hashes matched; requested copy was present; banned copy was absent; and logs showed no 5xx responses.

## Passage decisions

The table records the meaning of each changed passage without carrying obsolete wording into current product copy. Commit hashes preserve the complete historical text.

| Passage | Before `1129313` | Upstream change | Resolved copy and disposition |
| --- | --- | --- | --- |
| Application purpose | Described a phone-primary mapping application with seven stages, an instructor approval gate, and a named default evaluator. | Reframed the application around place-based ethnographic inquiry, undergraduate learning, Teacher Console customization, and an open-weight model, but retained seven stages and described model use as unconditional. | **Keep the pedagogical framing; reject the obsolete stage count and gate; qualify model use.** “Systems Mapping supports place-based ethnographic inquiry, asset mapping, and systems mapping in undergraduate courses. Students revisit a five-stage learning cycle across four scales. Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. Every stage and the map remain available while instructor review happens asynchronously. When a language model is configured, students can ask it to propose connections for them to review, edit, accept, or reject.” |
| Browser and server storage | Distinguished the map kept in the browser from evaluations, instructor reviews, teacher accounts, and shared course guidance kept on the classroom server. | Simplified this to say that student work remains in the browser while user records and shared guidance remain on the server. | **Reject the browser-only implication.** “The student’s map stays in the browser. When a student sends work for review, the classroom server stores a review copy and the instructor’s feedback. Teacher accounts and course guidance live in SQLite locally or PostgreSQL when hosted.” |
| Instructor review | Said that students could not choose what to map until the instructor approved their work and that returned work sent them backward. | Commit `fd7ca0b` deleted that approval-gate paragraph without replacing it. | **Accept the deletion and retain the current non-gating explanation.** “Sending work to the instructor creates a review copy. Instructor feedback never blocks another stage, node selection, or the map. Students can continue and check for feedback later.” |

## Release boundary

GitHub, local, and origin `main` contain the five-stage implementation through PR #5, and Railway deployment `39d38543-20ca-4626-95e6-237ef9213881` supplies clean commit-backed runtime provenance for implementation merge `abddbd0a2640aa0e4db0dcf0a1c47d65e9983597`. The branch carrying this release receipt changes documentation only and does not change runtime behavior. A complete live Teacher Console transaction, rendered reload/export browser journey, and live Ollama execution remain follow-up checks; successful tests, build, and Railway health checks do not substitute for them.
