# Field Notes recovery proposal

Field Notes use the existing `reflection` and `levelProgress[scale].reflection` storage fields so older projects and exports retain their writing. Switching Memo, Notebook or Tools, or hiding the sidebar, does not clear them. Field Notes are optional in the current account workflow; they never gate Continue. The existing account-scoped memo draft journal caches these fields on editing, before the debounced full-project save, and recovers compatible unsaved drafts. Notes from other scales are available in a collapsed reading section.

## Proposed additional protection

Add a separate, account/course/project/scale-scoped revision journal retaining the latest ten distinct drafts, bounded to 512 KiB per project. Capture a checkpoint after a pause in writing, before leaving a scale, and before a nonempty response becomes blank. Store the question as shown with each checkpoint so later instructor edits cannot change its context.

A blank edit may update the current response, but must not delete earlier nonempty checkpoints. A compact **Recover earlier draft** action should appear only when a different recoverable draft exists. Students preview and explicitly restore a version; recovery must never silently overwrite a newer local or cloud response. Restoring records a new revision.

Use the existing account/course storage scope and optimistic cloud revision fences. Preserve conflicting and unreadable copies for recovery rather than replacing them. Project deletion and retention behavior need explicit handling. Browser storage alone cannot recover work after browser data is cleared; durable cross-device revision history would need a separate server contract.

This separate revision-history cache remains a proposal. The current account implementation reuses the autosave/recovery journal and also stores bounded Undo/Redo for map, memo and note edits, including saved deletions while their entries remain in the edit history. That bounded history survives save/reload but does not provide this proposed per-scale draft archive or indefinite recovery after pruning. See the [current release receipt](../TODO.md#memo-workspace-release-receipt--november-5-2026) for verified deployment and acceptance.
