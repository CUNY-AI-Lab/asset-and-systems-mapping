# Instructor prompt customization

Open **Account → Instructor Console → Course settings**. Choose **Edit prompts**, select Micro, Meso, Exo, or Macro, and edit the **Field Notes prompt**. Reference the lesson's case, reading, or learning goal directly in the question. For example:

> Using our library case and this week's reading, whose direct relationships are missing? Plan an observation and identify a link between the focal person's everyday settings to investigate at Meso.

**Student preview** shows the current text immediately, including unsaved edits. **Publish changes** saves pending edits and publishes them in one action. Use **Save draft** to keep work for later without publishing. Students' existing answers remain intact when the question changes. Editing and previewing the prompt make no model request.

## Student-workflow boundary

The account workspace uses Memo · Notebook · Tools and four direct analytical steps, with optional Field Notes. Publishing a question does not make the answer required for Continue; the only checkpoint is successful memo-to-nodes processing for the current part. Students create all relationships. Model guidance and course material may inform source-grounded classification but cannot override the node-only output, independent source/update contract or student edits. Classification depends on focal participation and pathways, not institution names. This course places concrete policies/laws and outside offices at Exo, while Macro requires independently evidenced cultural, ideological, historical or economic conditions; see [classification evidence](CLASSIFICATION_EVIDENCE_2026-11-04.md).

The five internal Part × step settings remain a compatibility and provenance contract, not five student-facing account screens. Prompt editing never regenerates an unchanged student memo or changes a saved graph. Existing student notes and private analysis baselines are not exposed to instructors by these interface changes.

## Dashboard pattern

The primary screen places its status/action bar above one scale selector, one prompt field, and a collapsed student preview. Desktop fields sit side by side; narrow screens stack them. Prompt text is limited to the existing 1,200-character course contract. Publication requires a nonblank question for every scale. The editor finds and focuses a missing question before any write.

Draft names and audit notes are generated for routine editing. Named drafts and optional change notes remain under **Versions**. Model guidance and course materials stay in a separate collapsed section. They retain the existing Part and mapping-step contracts; Field Notes are organized by scale.

Published text is read-only until **Edit prompts** creates a draft. While saving or publishing, controls are disabled. The existing optimistic revision is checked on each write. If saving fails, publication stops. If publication fails after a successful save, the draft remains saved; another explicit click retries publication. Unsaved edits block version switching and trigger the browser's reload/close warning.

## Shared design rules

- Use the existing Source Sans 3 typeface, ink, muted, surface, line, and blue tokens. The Account title is 28px, prompt section title 20px, editable text 16px, and controls and labels 14–15px.
- Align form content to the left, limit the editor to 960px, and use consistent 16–24px spacing. Controls retain 44px minimum touch targets. Text wraps at narrow widths.
- Keep one primary action: **Edit prompts** for a published version, **Publish changes** for a draft. **Save draft** is secondary. The account workspace keeps identity and sign-out under **Account → Overview**. The separate Node console retains its dismissible Account menu.
- Student preview is optional and collapsed by default. It shows the same plain text students receive; the prompt does not support arbitrary HTML, CSS, or executable customization.
- The course roster is available on demand under **Submissions → Students and saved progress**. It loads only when opened and never sits above the console's navigation or prompt settings.

The implementation lives in `src/TeacherDashboard.jsx` and the scoped `src/course-settings.css`. The course schema, role checks, publication endpoints, and student Field Notes storage are unchanged.


## Controls and verification

| Area | Available controls and persistence | Verification |
| --- | --- | --- |
| Field Notes | Four scale prompts (1,200 characters each), immediate local Student preview, Save draft, Publish changes | Every scale survives save and a real Durable Object restart; student configuration changes only after publication. UI tests cover missing questions, unsaved preview, save and publication. |
| Model guidance and course materials | Part and mapping-step selectors, guidance (2,500 characters), course materials (4,000 characters), preview level, Add level note, Preview saved guidance | All ten Part × step pairs survive save/restart. All twenty applicable level × step previews return sanitized metadata without a full assembled prompt. UI tests cover local changes and saved-preview state. |
| Versions | Version selection, Create draft, draft name (120 characters), optional change note (500 characters), Cancel, read-only prior published versions | Runtime tests clone, rename, save, publish and restore the original version by cloning and publishing it. No separate reset button exists. History remains append-only. |
| Write recovery | Optimistic revision checks, explicit Load server revision, save-before-publish, explicit publish retry, leave-page warning | Existing tests cover stale-write conflicts, preserving local drafts, publication stopping after failed save, saved drafts surviving failed publication, unsaved-version switching and reload protection. |
| Submitted reviews | Refresh, select submitted record, feedback mode, instructor annotation, focused question, Record feedback, Reload current submission | Existing feedback tests cover revision conflicts, append-only events and retaining feedback during conflict recovery. Automatic queue reads pause while feedback is drafted. A failed queue read clears previously authorized remote work and history. |
| Students and saved progress | Open/close roster, Refresh students, More students, submitted-revision disclosure | Existing course API tests cover course-owner scope, role denial, pagination and progress metadata. New UI tests cover visible refresh, closed/hidden panels, late-response suppression and clearing content after access loss. |
| Console navigation | Submissions and Course settings tabs, Account menu, Escape dismissal, Back to project | Desktop and phone acceptance exercises the existing component patterns, keyboard behavior, prompt publication, compact empty state and accessibility checks. |

The visible review queue and opened roster refresh every 30 seconds and when the
browser returns to the foreground. Hidden tabs and collapsed roster panels do not
poll. These requests reuse the existing authenticated course APIs; they make no
model request and create no job. Course-settings drafts stay mounted when changing
tabs. Automatic submission refresh pauses while any feedback is being drafted.

Instructors see only the already-authorized course progress metadata and explicitly
submitted review snapshots. Private or unsubmitted maps and Field Notes do not
become instructor-visible. No role or cross-course permission changes are included.
Automated write verification uses synthetic accounts and work. The November 5 signed-in Dev visual check opened the live disclosures without editing or publishing course settings. Agustina's account and production course membership have not been inspected or verified.

## Account interface alignment — November 5, 2026

Account and Instructor Console navigation use the same active underline as Memo / Notebook / Tools. Prompt editing actions appear above the scale selector and prompt. Disclosure rows have an outlined full-row target and a chevron beside their label; Student preview, Guidance and materials, and Versions remain collapsed until opened and preserve keyboard operation. Guidance usage is shown directly inside its section. Text uses the shared interface tokens: 14px controls and labels, 16px editable content, and 44px minimum action targets. Broad console border-reset overrides have been removed.

The account console describes Field Notes as optional. The separate Node workflow retains its required reflection wording. This visual update does not change publication, revision conflict, model, roster access, or saved-draft behavior.
