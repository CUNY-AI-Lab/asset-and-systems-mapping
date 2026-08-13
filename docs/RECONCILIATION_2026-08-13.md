# Reconciliation record — 2026-08-13

## Outcome

Local `main` stopped at `7ad83ae`. `origin/main` advanced to `fd7ca0b` through two README-only commits: `1129313` and `fd7ca0b`. Neither upstream commit changed application code, tests, data, configuration, or deployment behavior.

The implemented and deployed five-stage application is the authority for this reconciliation. Its release checkpoint is `4bb915a`, deployed to Railway as `3ea599f4-7fb5-4dd3-998d-c55134a69f15`. The reconciled tree passed 160 tests with 3 PostgreSQL tests skipped, and the production build passed.

## Passage decisions

The table records the meaning of each changed passage without carrying obsolete wording into current product copy. Commit hashes preserve the complete historical text.

| Passage | Before `1129313` | Upstream change | Resolved copy and disposition |
| --- | --- | --- | --- |
| Application purpose | Described a phone-primary mapping application with seven stages, an instructor approval gate, and a named default evaluator. | Reframed the application around place-based ethnographic inquiry, undergraduate learning, Teacher Console customization, and an open-weight model, but retained seven stages and described model use as unconditional. | **Keep the pedagogical framing; reject the obsolete stage count and gate; qualify model use.** “Systems Mapping supports place-based ethnographic inquiry, asset mapping, and systems mapping in undergraduate courses. Students revisit a five-stage learning cycle across four scales. Part 1 groups Micro and Meso; Part 2 groups Macro and Integration. Every stage and the map remain available while instructor review happens asynchronously. When a language model is configured, students can ask it to propose connections for them to review, edit, accept, or reject.” |
| Browser and server storage | Distinguished the map kept in the browser from evaluations, instructor reviews, teacher accounts, and shared course guidance kept on the classroom server. | Simplified this to say that student work remains in the browser while user records and shared guidance remain on the server. | **Reject the browser-only implication.** “The student’s map stays in the browser. When a student sends work for review, the classroom server stores a review copy and the instructor’s feedback. Teacher accounts and course guidance live in SQLite locally or PostgreSQL when hosted.” |
| Instructor review | Said that students could not choose what to map until the instructor approved their work and that returned work sent them backward. | Commit `fd7ca0b` deleted that approval-gate paragraph without replacing it. | **Accept the deletion and retain the current non-gating explanation.** “Sending work to the instructor creates a review copy. Instructor feedback never blocks another stage, node selection, or the map. Students can continue and check for feedback later.” |

## Release boundary

Railway runs the checkpointed five-stage working-tree snapshot identified above. GitHub `main` is not current until this branch is reviewed and merged, and Railway does not gain commit-backed provenance until that merged commit is deployed. A live Teacher Console journey and live Ollama execution remain follow-up checks; successful local tests, build, and Railway health checks do not substitute for those two browser-level checks.
