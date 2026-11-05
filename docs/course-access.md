# Course workspace access contract

This document defines course workspaces and instructor prompt appendices for the Cloudflare application. Source/configuration capability is separate from live course activation and signed-in acceptance; use dated release receipts for those claims. General and course storage remain separate, and the Node/Railway application retains its own data. The latest Memo workspace changes do not grant enrollment or alter this authority contract.

## Activation boundary

Course access is off unless the deployment sets `COURSE_ACCESS_ENABLED` to the exact string `true`. `COURSE_IDS` must contain the explicitly approved course IDs as a comma-separated allowlist, with at most 20 entries. An absent or empty allowlist permits no courses. The checked-in production configuration (`wrangler.jsonc`) now enables course access for two IDs: `understanding-systems-impacting-youth-and-families-fall-2026-01` and the fixed guest-instructor demo `cail-teaching-tools-demo`. The dev Worker configuration is separate. Enabling an ID here admits nobody by itself; every request still requires a fresh Admission receipt for that exact course.

The browser selects a course through `?course=<class-id>` and sends that selection as `x-systems-course`. A course selection is not an entitlement. The server requires a fresh private Admission receipt for the authenticated subject and that exact configured course. Invalid selections, disabled configuration, missing enrollment, stale or malformed receipts, and unavailable authority fail closed. An explicit course request never falls back to the general workspace.

This implementation calls Admission as `app: "systems-mapping"` with the opaque member namespace `systems-mapping-member-v1-<64 lowercase hexadecimal characters>`. The adapter deliberately rejects Stem member IDs and never calls Admission under Stem's app identity. The shared `cail-knowledge-base` (Admission Control note, October 2026) records the guest-instructor V2 receipts for the demo course and that Doorway exposes the demo destination only when fresh Stem and Systems Mapping receipts agree; it records no separate acceptance of the Systems Mapping namespace for the Fall 2026 course ID above. Treat live access for that course as unverified until a signed-in instructor and student session is recorded.

Maria's collaborator attribution is known, but her canonical CUNY subject, current course ID, owner relationship and enrolled roster have not been confirmed. This implementation creates no enrollment, owner grant or default Maria course. This source contract creates no live enrollment or owner grant. Permission/shared-backend changes require their own authorized evidence, separately from the authorized application release.

## Identity and current authority

The application uses its existing `IDENTITY -> cail-doorway / WorkerIdentity` binding and CUNY Login flow. Deployment properties pin the Systems Mapping audience and callback Worker. Course and project destinations survive the bounded login return path. Browser-supplied identity headers do not become authority.

`cloudflare/course-access.ts` checks the complete receipt field set, requested class, dedicated member-ID namespace, current start/expiry dates, bounded display fields, boolean roles and a nonnegative safe revision. Receipts must use canonical UTC dates, be less than 30 seconds old, and be no more than five seconds ahead of the local clock. The private resolver call has a five-second deadline.

Current course participation or ownership permits course access. Only the receipt's `owner` role permits instructor operations in that course; a general administrator does not receive a course-owner override. A course owner does not gain general instructor access. Every course API request resolves authority again, and model dispatch checks enrollment again immediately before invoking the Gateway. Revocation affects subsequent requests without requiring another login.

## Storage and browser isolation

The Worker routes each authorized course to a separate Durable Object named `systems-mapping:course:<class-id>`. General requests continue to use the existing `COURSE_ID` object. Course account ownership derives from the app/course-scoped opaque member ID, and project reads and writes require that owner within the selected object.

Each account in each workspace receives an independent random browser cache key. The client captures the course selection and cache adapter before asynchronous requests or queued saves. The server rejects a stale account cache key, and caller-supplied request headers cannot override the client's captured workspace. Returning to Projects and creating a project link preserve course selection.

Project links retain their existing bearer-capability behavior within the selected workspace, with current course access required. A course link cannot resolve in another course or in the general workspace. An instructor's course permission does not grant access to another account's private cloud project by ID. Existing unsynced device copies remain in their original cache for recovery.

## Instructor appendices

Course owners use the Course guidance editor on the account dashboard. The server exposes:

| Endpoint | Allowed operation |
| --- | --- |
| `/api/cloud/course-prompt` | Owner-only GET of the current appendix and PUT of a new revision |
| `/api/cloud/course-prompt/history` | Owner-only GET of the newest 100 retained revisions |

PUT accepts exactly `{ amendment, expectedRevision, changeNote }`. The amendment is limited to 2,000 characters. A change note must contain 1–240 trimmed characters, and the expected revision must be a nonnegative safe integer. Invalid bodies and control characters are rejected. A stale revision returns 409, and an unchanged amendment does not create another revision.

The current value and new history record are written in one Durable Object transaction. Existing history has no update or delete API. Each new record contains its revision, timestamp, change note, server-derived course and opaque instructor member IDs, appendix format version, and SHA-256 amendment hash. The format version and amendment hash describe the appendix; they are not a snapshot of the entire application source or base prompt.

`shared/course-prompt.js` appends the saved text after the application's composed instructions. It explicitly subordinates course guidance to the fixed level definitions, student agency, privacy rules and output schema. Editing the appendix replaces the current appendix while preserving prior revisions; it does not replace the fixed application instructions.

Account memo submissions/updates receive only the selected course's appendix and remain node-only; the appendix cannot enable automatic relationships, require Field Notes or override current-part memo gating. Retained legacy guidance and connection APIs also use only the selected course appendix. The effective prompt fingerprint and configuration metadata incorporate its revision and content hash. Model dispatch refuses an appendix revision that changed after the request captured its settings. Student metadata includes fingerprints and revision identifiers, not the appendix text, history or instructor identity. Prompt changes leave other courses and the general workspace unchanged.

## Errors and verification

Visible errors describe the next action without exposing internal exception text, identity values, backend details or machine codes. Separate responses cover unavailable course authority, denied enrollment, changed settings and invalid input. Optimistic-edit conflicts preserve the instructor's draft while the editor loads the latest saved revision for comparison.

Use the package's Node 22.5-or-newer runtime and pnpm. These commands run local checks from the repository root:

```sh
# Strict authority parsing, selectors, request/cache isolation and editor behavior.
pnpm test cloudflare/course-access.test.ts src/courseContext.test.js src/api.test.js src/AccountWorkspace.test.jsx src/CoursePromptEditor.test.jsx src/userFacingError.test.js

# Build assets before exercising local Worker/service-binding/Durable Object paths.
pnpm build:cloudflare
pnpm test cloudflare/course-workerd.test.js cloudflare/workerd.test.js

# Cloudflare type validation and production-shaped local bundle; no deployment.
pnpm typecheck:cloudflare
pnpm check:cloudflare

# General frontend and Node regression coverage, including application behavior.
pnpm test:server
pnpm test src/App.test.jsx src/TeacherDashboard.test.jsx
pnpm build
```

`check:cloudflare` invokes Wrangler with `--dry-run`; it does not deploy. The course Worker harness uses synthetic identities, course receipts, stored projects and model responses. It exercises course/general storage and link isolation, current enrollment, exact-course ownership, unavailable authority, atomic prompt conflicts, persisted history, student metadata and model prompt selection. These checks establish local behavior only. They do not confirm real CUNY sign-in, Maria's authority, a live roster, the proposed upstream namespace or live course activation.

## Guest instructors

The course resolver uses Admission's V2 methods. A guest instructor is a
separate course assignment with explicit instructor-panel, roster-read,
prompt-read and prompt-write capabilities. The application checks a fresh
receipt on each request. Guest assignments do not imply ownership, student
membership, or general administrator access.

The production course allowlist includes `cail-teaching-tools-demo` and the
existing Understanding Systems course. Demo invitations are issued through
CAIL Admin MCP, bound to verified CUNY identities, and revocable in Admission.
The persistent grant remains active until revocation; resolver receipts and
SSO sessions retain finite expiration times.

Course guidance history compares an earlier published revision with the
current revision. Restore copies the earlier text into a draft, and saving
creates a new revision with a change note and concurrency check. System prompt
inspection shows read-only base and effective prompts and their fingerprints.
The Instructor Console's course-settings drafts remain scoped to the selected
course's Durable Object.
