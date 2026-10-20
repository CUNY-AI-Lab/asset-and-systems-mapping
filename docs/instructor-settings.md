# Instructor prompt customization

Open **Teacher Console → Course settings**. Choose **Edit prompts**, select Micro, Meso, Exo, or Macro, and edit the **Field Notes prompt**. Reference the lesson's case, reading, or learning goal directly in the question. For example:

> Using our library case and this week's reading, whose direct relationships are missing? Plan an observation and identify a link between the focal person's everyday settings to investigate at Meso.

**Student preview** shows the current text immediately, including unsaved edits. **Publish changes** saves pending edits and publishes them in one action. Use **Save draft** to keep work for later without publishing. Students' existing answers remain intact when the question changes. Editing and previewing the prompt make no model request.

## Dashboard pattern

The primary screen contains one scale selector, one prompt field, a collapsed student preview, and a status/action bar. Prompt text is limited to the existing 1,200-character course contract. Publication requires a nonblank question for every scale. The editor finds and focuses a missing question before any write.

Draft names and audit notes are generated for routine editing. Named drafts and optional change notes remain under **Versions and change history**. Model guidance and course materials stay in a separate collapsed section. They retain the existing Part and mapping-step contracts; Field Notes are organized by scale.

Published text is read-only until **Edit prompts** creates a draft. While saving or publishing, controls are disabled. The existing optimistic revision is checked on each write. If saving fails, publication stops. If publication fails after a successful save, the draft remains saved; another explicit click retries publication. Unsaved edits block version switching and trigger the browser's reload/close warning.

## Shared design rules

- Use the existing Source Sans 3 typeface, ink, muted, surface, line, and blue tokens. The dashboard title is 24–26px, section title 22px, editable text 16px, and labels/status text 14px.
- Align form content to the left, limit the editor to 960px, and use consistent 16–24px spacing. Controls retain 44px minimum touch targets. Text wraps at narrow widths.
- Keep one primary action: **Edit prompts** for a published version, **Publish changes** for a draft. **Save draft** is secondary. Account identity and sign-out live in a dismissible **Account** menu.
- Student preview is optional and collapsed by default. It shows the same plain text students receive; the prompt does not support arbitrary HTML, CSS, or executable customization.

The implementation lives in `src/TeacherDashboard.jsx` and the scoped `src/course-settings.css`. The course schema, role checks, publication endpoints, and student Field Notes storage are unchanged.
